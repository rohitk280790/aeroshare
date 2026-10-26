/**
 * RoKaShare — WebRTC Peer-to-Peer & WebSocket Signaling Client
 * 
 * Architecture:
 * - Viewers who join BEFORE presenter starts sharing are queued (pendingViewers)
 * - WebRTC peer connections are ONLY created when a stream is ready
 * - This avoids renegotiation (adding tracks post-connection), which breaks on many mobile browsers
 * - When stream updates, existing connections use replaceTrack (no re-negotiation needed)
 */

class WebRTCManager {
  constructor() {
    this.ws = null;
    this.clientId = null;
    this.roomId = null;
    this.role = null; // 'presenter' | 'viewer'
    this.peers = new Map(); // viewerId -> { pc, dataChannel, iceQueue }
    this.pendingViewers = new Set(); // viewers waiting for stream to be ready
    this.presenterPc = null; // viewer-side peer connection
    this.presenterDataChannel = null;
    this.iceCandidateQueue = [];
    this.activeStream = null;
    this.remoteStream = null; // single persistent MediaStream for viewer

    this.rtcConfig = {
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' },
        { urls: 'stun:stun.cloudflare.com:3478' },
        { urls: 'stun:global.stun.twilio.com:3478' },
        // OpenRelay TURN (NAT traversal for mobile/Render)
        {
          urls: 'turn:openrelay.metered.ca:80',
          username: 'openrelay',
          credential: 'openrelay'
        },
        {
          urls: 'turn:openrelay.metered.ca:443',
          username: 'openrelay',
          credential: 'openrelay'
        },
        {
          urls: 'turns:openrelay.metered.ca:443?transport=tcp',
          username: 'openrelay',
          credential: 'openrelay'
        }
      ],
      iceCandidatePoolSize: 10
    };

    // Event hooks
    this.onConnected = () => {};
    this.onRoomJoined = () => {};
    this.onRoomCreated = () => {};
    this.onRemoteStream = () => {};
    this.onPresenterStatus = () => {};
    this.onViewersUpdated = () => {};
    this.onChatMessage = () => {};
    this.onEmojiReaction = () => {};
    this.onHandRaised = () => {};
    this.onAnnotationReceived = () => {};
    this.onError = () => {};
    this.onPresenterLeft = () => {};
  }

  connect() {
    return new Promise((resolve, reject) => {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${protocol}//${window.location.host}`;

      this.ws = new WebSocket(wsUrl);

      this.ws.onopen = () => {
        console.log('[WebRTC] Signaling connected');
      };

      this.ws.onerror = (err) => {
        console.error('[WebRTC] WebSocket error:', err);
        this.onError('Signaling connection error. Please refresh.');
        reject(err);
      };

      this.ws.onclose = () => {
        console.log('[WebRTC] Signaling disconnected');
      };

      // Wait for 'connected' message to get our clientId
      this.ws.onmessage = async (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === 'connected') {
            this.clientId = msg.clientId;
            // Switch to the main message handler
            this.ws.onmessage = async (e) => {
              try {
                await this.handleSignalingMessage(JSON.parse(e.data));
              } catch (err) {
                console.error('[WebRTC] Error handling message:', err);
              }
            };
            resolve(msg.clientId);
            this.onConnected(msg.clientId);
          }
        } catch (err) {
          console.error('[WebRTC] Error parsing initial message:', err);
        }
      };
    });
  }

  send(type, payload = {}) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type, ...payload }));
    }
  }

  createRoom(customRoomId, presenterName) {
    this.role = 'presenter';
    this.send('create-room', {
      customRoomId: customRoomId || '',
      name: presenterName || 'Presenter'
    });
  }

  joinRoom(roomId, viewerName) {
    this.role = 'viewer';
    this.send('join-room', {
      roomId: roomId.trim().toUpperCase(),
      name: viewerName || 'Viewer'
    });
  }

  updatePresenterStatus(isSharing) {
    if (this.role === 'presenter') {
      this.send('presenter-status', { isSharing });
    }
  }

  async handleSignalingMessage(msg) {
    switch (msg.type) {
      case 'room-created': {
        this.roomId = msg.roomId;
        this.role = 'presenter';
        this.onRoomCreated(msg);
        break;
      }

      case 'room-joined': {
        this.roomId = msg.roomId;
        this.role = 'viewer';
        this.onRoomJoined(msg);
        break;
      }

      case 'presenter-status': {
        this.onPresenterStatus(msg.isSharing);
        break;
      }

      case 'room-viewers-updated': {
        this.onViewersUpdated(msg.viewerCount, msg.viewers);
        break;
      }

      // Presenter receives new viewer notification
      case 'peer-joined': {
        if (this.role === 'presenter') {
          console.log(`[WebRTC] Viewer joined: ${msg.peerId}`);
          if (this.activeStream) {
            // Stream is already live — connect immediately with video
            await this.initiatePeerConnection(msg.peerId);
          } else {
            // Stream not started yet — queue this viewer
            console.log(`[WebRTC] Stream not live yet, queuing viewer: ${msg.peerId}`);
            this.pendingViewers.add(msg.peerId);
          }
        }
        break;
      }

      // Presenter receives viewer exit
      case 'peer-left': {
        if (this.role === 'presenter') {
          console.log(`[WebRTC] Viewer left: ${msg.peerId}`);
          this.pendingViewers.delete(msg.peerId);
          if (this.peers.has(msg.peerId)) {
            const peer = this.peers.get(msg.peerId);
            if (peer.pc) peer.pc.close();
            this.peers.delete(msg.peerId);
          }
        }
        break;
      }

      // Viewer receives WebRTC offer from presenter
      case 'webrtc-offer': {
        if (this.role === 'viewer') {
          console.log('[WebRTC] Received offer from presenter');
          await this.handleOffer(msg.senderId, msg.sdp);
        }
        break;
      }

      // Presenter receives WebRTC answer from viewer
      case 'webrtc-answer': {
        if (this.role === 'presenter' && this.peers.has(msg.senderId)) {
          console.log(`[WebRTC] Received answer from viewer: ${msg.senderId}`);
          const peer = this.peers.get(msg.senderId);
          try {
            await peer.pc.setRemoteDescription(new RTCSessionDescription(msg.sdp));
            // Flush any buffered ICE candidates
            while (peer.iceQueue && peer.iceQueue.length > 0) {
              const cand = peer.iceQueue.shift();
              try {
                await peer.pc.addIceCandidate(new RTCIceCandidate(cand));
              } catch (e) {
                console.warn('[WebRTC] Error adding buffered ICE:', e);
              }
            }
          } catch (err) {
            console.error('[WebRTC] Error setting remote description on presenter:', err);
          }
        }
        break;
      }

      // ICE candidate exchange
      case 'webrtc-ice': {
        await this.handleIceCandidate(msg.senderId, msg.candidate);
        break;
      }

      case 'chat-message': {
        this.onChatMessage(msg);
        break;
      }

      case 'emoji-reaction': {
        this.onEmojiReaction(msg);
        break;
      }

      case 'hand-raised': {
        this.onHandRaised(msg);
        break;
      }

      case 'annotation-sync': {
        if (this.role === 'viewer') {
          this.onAnnotationReceived(msg.action, msg.data);
        }
        break;
      }

      case 'presenter-left': {
        this.onPresenterLeft(msg.message);
        break;
      }

      case 'error': {
        this.onError(msg.message);
        break;
      }
    }
  }

  // ==========================================
  // PRESENTER: Peer Management & Offer Creation
  // ==========================================

  async initiatePeerConnection(viewerId) {
    // Close any existing connection for this viewer
    if (this.peers.has(viewerId)) {
      const old = this.peers.get(viewerId);
      if (old.pc) old.pc.close();
    }

    const pc = new RTCPeerConnection(this.rtcConfig);
    const dataChannel = pc.createDataChannel('aero-sync', { ordered: true });
    this.setupDataChannel(dataChannel);

    this.peers.set(viewerId, { pc, dataChannel, iceQueue: [] });

    // Add ALL active stream tracks — stream is guaranteed live at this point
    if (this.activeStream) {
      console.log(`[WebRTC] Adding ${this.activeStream.getTracks().length} tracks for viewer ${viewerId}`);
      this.activeStream.getTracks().forEach((track) => {
        pc.addTrack(track, this.activeStream);
      });
    }

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        this.send('webrtc-ice', {
          targetId: viewerId,
          candidate: event.candidate
        });
      }
    };

    pc.onconnectionstatechange = () => {
      console.log(`[WebRTC] Connection state with ${viewerId}: ${pc.connectionState}`);
      if (pc.connectionState === 'failed') {
        console.warn(`[WebRTC] Connection failed for ${viewerId}, attempting ICE restart`);
        this.restartIce(viewerId);
      }
      if (pc.connectionState === 'disconnected' || pc.connectionState === 'closed') {
        this.peers.delete(viewerId);
      }
    };

    pc.oniceconnectionstatechange = () => {
      console.log(`[WebRTC] ICE state with ${viewerId}: ${pc.iceConnectionState}`);
    };

    try {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      console.log(`[WebRTC] Sending offer to viewer ${viewerId}, has video: ${offer.sdp.includes('m=video')}`);

      this.send('webrtc-offer', {
        targetId: viewerId,
        sdp: offer
      });
    } catch (err) {
      console.error('[WebRTC] Error creating offer:', err);
    }
  }

  async restartIce(viewerId) {
    const peer = this.peers.get(viewerId);
    if (!peer || !peer.pc || peer.pc.signalingState === 'closed') return;
    try {
      const offer = await peer.pc.createOffer({ iceRestart: true });
      await peer.pc.setLocalDescription(offer);
      this.send('webrtc-offer', { targetId: viewerId, sdp: offer });
    } catch (err) {
      console.warn('[WebRTC] ICE restart failed:', err);
    }
  }

  // Called when presenter starts/changes/stops sharing screen
  updateActiveStream(stream) {
    this.activeStream = stream;
    if (this.role !== 'presenter') return;

    if (stream) {
      // Connect any viewers who were queued (joined before stream started)
      if (this.pendingViewers.size > 0) {
        console.log(`[WebRTC] Stream now live — connecting ${this.pendingViewers.size} pending viewers`);
        const toConnect = [...this.pendingViewers];
        this.pendingViewers.clear();
        toConnect.forEach(viewerId => {
          this.initiatePeerConnection(viewerId);
        });
      }

      // For already-connected peers: replace tracks (no renegotiation needed for replaceTrack)
      this.peers.forEach(async (peer, viewerId) => {
        if (!peer.pc || peer.pc.signalingState === 'closed') return;
        const senders = peer.pc.getSenders();
        const videoTrack = stream.getVideoTracks()[0];
        const audioTrack = stream.getAudioTracks()[0];

        let videoReplaced = false;
        let audioReplaced = false;

        for (const sender of senders) {
          if (sender.track && sender.track.kind === 'video' && videoTrack) {
            await sender.replaceTrack(videoTrack);
            videoReplaced = true;
          }
          if (sender.track && sender.track.kind === 'audio' && audioTrack) {
            await sender.replaceTrack(audioTrack);
            audioReplaced = true;
          }
        }

        // If tracks weren't replaced (new kind), need to add them + renegotiate
        if (!videoReplaced && videoTrack) {
          peer.pc.addTrack(videoTrack, stream);
          await this._renegotiate(viewerId, peer.pc);
        }
        if (!audioReplaced && audioTrack) {
          peer.pc.addTrack(audioTrack, stream);
          // Only renegotiate once if both needed (already done above if video triggered it)
          if (videoReplaced) {
            await this._renegotiate(viewerId, peer.pc);
          }
        }
      });
    } else {
      // Stream stopped: null out all tracks
      this.peers.forEach((peer) => {
        if (!peer.pc || peer.pc.signalingState === 'closed') return;
        peer.pc.getSenders().forEach((s) => {
          s.replaceTrack(null).catch(() => {});
        });
      });
    }
  }

  async _renegotiate(viewerId, pc) {
    try {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      this.send('webrtc-offer', { targetId: viewerId, sdp: offer });
    } catch (err) {
      console.error('[WebRTC] Renegotiation error:', err);
    }
  }

  // ==========================================
  // VIEWER: Offer Handling & Answer Creation
  // ==========================================

  async handleOffer(presenterId, sdp) {
    let pc = this.presenterPc;

    // Only create a new RTCPeerConnection if none exists or was closed
    if (!pc || pc.signalingState === 'closed') {
      pc = new RTCPeerConnection(this.rtcConfig);
      this.presenterPc = pc;
      // Single persistent MediaStream — tracks added to it, never replaced
      this.remoteStream = new MediaStream();

      pc.ontrack = (event) => {
        const track = event.track;
        console.log('[WebRTC] ontrack:', track.kind, 'readyState:', track.readyState, 'muted:', track.muted);

        // Replace existing track of same kind in our persistent stream
        const existing = this.remoteStream.getTracks().find(t => t.kind === track.kind);
        if (existing) {
          this.remoteStream.removeTrack(existing);
        }
        this.remoteStream.addTrack(track);

        // Notify app with stable stream reference
        this.onRemoteStream(this.remoteStream);

        track.onunmute = () => {
          console.log('[WebRTC] Track unmuted:', track.kind);
          this.onRemoteStream(this.remoteStream);
        };
        track.onended = () => {
          console.log('[WebRTC] Track ended:', track.kind);
        };
      };

      pc.ondatachannel = (event) => {
        console.log('[WebRTC] DataChannel received');
        this.presenterDataChannel = event.channel;
        this.setupDataChannel(event.channel);
      };

      pc.onicecandidate = (event) => {
        if (event.candidate) {
          this.send('webrtc-ice', { targetId: presenterId, candidate: event.candidate });
        }
      };

      pc.onconnectionstatechange = () => {
        console.log(`[WebRTC] Viewer connection: ${pc.connectionState}`);
      };

      pc.oniceconnectionstatechange = () => {
        console.log(`[WebRTC] Viewer ICE: ${pc.iceConnectionState}`);
      };
    }

    try {
      console.log('[WebRTC] setRemoteDescription, signalingState:', pc.signalingState);
      await pc.setRemoteDescription(new RTCSessionDescription(sdp));

      // Flush buffered ICE candidates
      while (this.iceCandidateQueue.length > 0) {
        const candidate = this.iceCandidateQueue.shift();
        try {
          await pc.addIceCandidate(new RTCIceCandidate(candidate));
        } catch (e) {
          console.warn('[WebRTC] Buffered ICE add error:', e);
        }
      }

      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      console.log('[WebRTC] Answer sent');

      this.send('webrtc-answer', { targetId: presenterId, sdp: answer });
    } catch (err) {
      console.error('[WebRTC] handleOffer error:', err);
    }
  }

  async handleIceCandidate(senderId, candidate) {
    if (!candidate) return;

    if (this.role === 'presenter' && this.peers.has(senderId)) {
      const peer = this.peers.get(senderId);
      if (peer.pc && peer.pc.remoteDescription) {
        try {
          await peer.pc.addIceCandidate(new RTCIceCandidate(candidate));
        } catch (err) {
          console.warn('[WebRTC] ICE add error (presenter):', err);
        }
      } else {
        if (!peer.iceQueue) peer.iceQueue = [];
        peer.iceQueue.push(candidate);
      }
    } else if (this.role === 'viewer') {
      if (this.presenterPc && this.presenterPc.remoteDescription) {
        try {
          await this.presenterPc.addIceCandidate(new RTCIceCandidate(candidate));
        } catch (err) {
          console.warn('[WebRTC] ICE add error (viewer):', err);
        }
      } else {
        this.iceCandidateQueue.push(candidate);
      }
    }
  }

  // ==========================================
  // DATA CHANNEL: Annotation Sync
  // ==========================================

  setupDataChannel(channel) {
    channel.onopen = () => console.log('[DataChannel] Open');
    channel.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data);
        if (payload.type === 'annotation') {
          this.onAnnotationReceived(payload.action, payload.data);
        }
      } catch (err) {
        console.error('[DataChannel] Parse error:', err);
      }
    };
  }

  broadcastAnnotation(action, data) {
    const payload = JSON.stringify({ type: 'annotation', action, data });
    let sentViaDataChannel = false;
    this.peers.forEach((peer) => {
      if (peer.dataChannel && peer.dataChannel.readyState === 'open') {
        peer.dataChannel.send(payload);
        sentViaDataChannel = true;
      }
    });
    if (!sentViaDataChannel) {
      this.send('annotation-sync', { action, data });
    }
  }

  sendChatMessage(text) { this.send('chat-message', { text }); }
  sendEmojiReaction(emoji) { this.send('emoji-reaction', { emoji }); }
  raiseHand() { this.send('raise-hand'); }

  leave() {
    this.send('leave-room');
    if (this.presenterPc) {
      this.presenterPc.close();
      this.presenterPc = null;
    }
    this.peers.forEach((peer) => { if (peer.pc) peer.pc.close(); });
    this.peers.clear();
    this.pendingViewers.clear();
  }
}

window.WebRTCManager = WebRTCManager;
