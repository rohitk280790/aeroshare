/**
 * AeroShare — WebRTC Peer-to-Peer & WebSocket Signaling Client
 */

class WebRTCManager {
  constructor() {
    this.ws = null;
    this.clientId = null;
    this.roomId = null;
    this.role = null; // 'presenter' | 'viewer'
    this.peers = new Map(); // viewerId -> { pc, dataChannel } (for presenter)
    this.presenterPc = null; // (for viewer)
    this.presenterDataChannel = null;
    this.iceCandidateQueue = [];
    this.activeStream = null;

    this.rtcConfig = {
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' }
      ]
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

      this.ws.onmessage = async (event) => {
        try {
          const msg = JSON.parse(event.data);
          await this.handleSignalingMessage(msg);
        } catch (err) {
          console.error('[WebRTC] Error parsing signaling message:', err);
        }
      };

      this.ws.onerror = (err) => {
        console.error('[WebRTC] WebSocket error:', err);
        this.onError('Signaling connection error. Please refresh.');
        reject(err);
      };

      this.ws.onclose = () => {
        console.log('[WebRTC] Signaling disconnected');
      };

      // Resolve when connected message arrives
      const origOnMessage = this.ws.onmessage;
      this.ws.onmessage = async (event) => {
        const msg = JSON.parse(event.data);
        if (msg.type === 'connected') {
          this.clientId = msg.clientId;
          this.ws.onmessage = origOnMessage;
          resolve(msg.clientId);
          this.onConnected(msg.clientId);
        }
        await origOnMessage(event);
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

      // Presenter receives new viewer notification -> initiate WebRTC offer
      case 'peer-joined': {
        if (this.role === 'presenter') {
          console.log(`[WebRTC] Viewer joined: ${msg.peerId}`);
          await this.initiatePeerConnection(msg.peerId);
        }
        break;
      }

      // Presenter receives viewer exit
      case 'peer-left': {
        if (this.role === 'presenter' && this.peers.has(msg.peerId)) {
          console.log(`[WebRTC] Viewer left: ${msg.peerId}`);
          const peer = this.peers.get(msg.peerId);
          if (peer.pc) peer.pc.close();
          this.peers.delete(msg.peerId);
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
          await peer.pc.setRemoteDescription(new RTCSessionDescription(msg.sdp));
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
    const pc = new RTCPeerConnection(this.rtcConfig);
    const dataChannel = pc.createDataChannel('aero-sync', { ordered: true });
    this.setupDataChannel(dataChannel);

    this.peers.set(viewerId, { pc, dataChannel });

    // Add active media tracks (Screen + Audio)
    if (this.activeStream) {
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
      if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed') {
        this.peers.delete(viewerId);
      }
    };

    try {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      this.send('webrtc-offer', {
        targetId: viewerId,
        sdp: offer
      });
    } catch (err) {
      console.error('[WebRTC] Error creating offer:', err);
    }
  }

  // Update stream for all connected viewers when presenter starts/switches screen
  updateActiveStream(stream) {
    this.activeStream = stream;
    if (this.role !== 'presenter') return;

    this.peers.forEach(async (peer, viewerId) => {
      const senders = peer.pc.getSenders();
      
      // If we already have senders, replace tracks
      if (senders.length > 0 && stream) {
        const videoTrack = stream.getVideoTracks()[0];
        const audioTrack = stream.getAudioTracks()[0];

        senders.forEach((sender) => {
          if (sender.track && sender.track.kind === 'video' && videoTrack) {
            sender.replaceTrack(videoTrack);
          } else if (sender.track && sender.track.kind === 'audio' && audioTrack) {
            sender.replaceTrack(audioTrack);
          }
        });
      } else if (stream) {
        // Add tracks and renegotiate
        stream.getTracks().forEach((track) => {
          peer.pc.addTrack(track, stream);
        });

        try {
          const offer = await peer.pc.createOffer();
          await peer.pc.setLocalDescription(offer);
          this.send('webrtc-offer', {
            targetId: viewerId,
            sdp: offer
          });
        } catch (err) {
          console.error('[WebRTC] Renegotiation error:', err);
        }
      }
    });
  }

  // ==========================================
  // VIEWER: Offer Handling & Answer Creation
  // ==========================================

  async handleOffer(presenterId, sdp) {
    if (this.presenterPc) {
      this.presenterPc.close();
    }

    const pc = new RTCPeerConnection(this.rtcConfig);
    this.presenterPc = pc;

    pc.ontrack = (event) => {
      console.log('[WebRTC] Received remote stream track:', event.track.kind);
      if (event.streams && event.streams[0]) {
        this.onRemoteStream(event.streams[0]);
      }
    };

    pc.ondatachannel = (event) => {
      console.log('[WebRTC] Received DataChannel from presenter');
      this.presenterDataChannel = event.channel;
      this.setupDataChannel(event.channel);
    };

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        this.send('webrtc-ice', {
          targetId: presenterId,
          candidate: event.candidate
        });
      }
    };

    try {
      await pc.setRemoteDescription(new RTCSessionDescription(sdp));

      // Process any buffered ICE candidates
      while (this.iceCandidateQueue.length > 0) {
        const candidate = this.iceCandidateQueue.shift();
        await pc.addIceCandidate(new RTCIceCandidate(candidate));
      }

      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);

      this.send('webrtc-answer', {
        targetId: presenterId,
        sdp: answer
      });
    } catch (err) {
      console.error('[WebRTC] Error handling offer:', err);
    }
  }

  async handleIceCandidate(senderId, candidate) {
    if (!candidate) return;

    if (this.role === 'presenter' && this.peers.has(senderId)) {
      const peer = this.peers.get(senderId);
      try {
        await peer.pc.addIceCandidate(new RTCIceCandidate(candidate));
      } catch (err) {
        console.error('[WebRTC] Error adding ICE candidate:', err);
      }
    } else if (this.role === 'viewer') {
      if (this.presenterPc && this.presenterPc.remoteDescription) {
        try {
          await this.presenterPc.addIceCandidate(new RTCIceCandidate(candidate));
        } catch (err) {
          console.error('[WebRTC] Error adding ICE candidate on viewer:', err);
        }
      } else {
        this.iceCandidateQueue.push(candidate);
      }
    }
  }

  // ==========================================
  // DATA CHANNEL: Ultra-Low-Latency Sync
  // ==========================================

  setupDataChannel(channel) {
    channel.onopen = () => {
      console.log('[DataChannel] Open');
    };

    channel.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data);
        if (payload.type === 'annotation') {
          this.onAnnotationReceived(payload.action, payload.data);
        }
      } catch (err) {
        console.error('[DataChannel] Error parsing message:', err);
      }
    };
  }

  broadcastAnnotation(action, data) {
    const payload = JSON.stringify({ type: 'annotation', action, data });

    // Send via DataChannel to all connected peers
    let sentViaDataChannel = false;
    this.peers.forEach((peer) => {
      if (peer.dataChannel && peer.dataChannel.readyState === 'open') {
        peer.dataChannel.send(payload);
        sentViaDataChannel = true;
      }
    });

    // Fallback over WebSocket signaling server if no data channels are open
    if (!sentViaDataChannel) {
      this.send('annotation-sync', { action, data });
    }
  }

  sendChatMessage(text) {
    this.send('chat-message', { text });
  }

  sendEmojiReaction(emoji) {
    this.send('emoji-reaction', { emoji });
  }

  raiseHand() {
    this.send('raise-hand');
  }

  leave() {
    this.send('leave-room');
    if (this.presenterPc) {
      this.presenterPc.close();
      this.presenterPc = null;
    }
    this.peers.forEach((peer) => {
      if (peer.pc) peer.pc.close();
    });
    this.peers.clear();
  }
}

window.WebRTCManager = WebRTCManager;
