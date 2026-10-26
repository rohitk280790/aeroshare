/**
 * AeroShare — Master Application Controller
 */

document.addEventListener('DOMContentLoaded', async () => {
  // 1. Initialize Sub-Managers
  const ui = new UIManager();
  const webrtc = new WebRTCManager();
  const screen = new ScreenManager();
  const recorder = new SessionRecorder();

  // DOM Elements
  const viewLobby = document.getElementById('view-lobby');
  const viewStudio = document.getElementById('view-studio');

  const formHost = document.getElementById('form-host');
  const formJoin = document.getElementById('form-join');
  const hostNameInput = document.getElementById('host-name');
  const hostQualitySelect = document.getElementById('host-quality');
  const customRoomCodeInput = document.getElementById('custom-room-code');
  const joinRoomCodeInput = document.getElementById('join-room-code');
  const viewerNameInput = document.getElementById('viewer-name');

  const screenVideo = document.getElementById('screen-video');
  const videoWrapper = document.getElementById('video-wrapper');
  const annotationCanvas = document.getElementById('annotation-canvas');
  const laserCanvas = document.getElementById('laser-canvas');

  const webcamPip = document.getElementById('webcam-pip');
  const webcamVideo = document.getElementById('webcam-video');
  const pipDragHandle = document.getElementById('pip-drag-handle');
  const webcam = new WebcamManager(webcamPip, webcamVideo, pipDragHandle, videoWrapper);

  const annotations = new AnnotationEngine(annotationCanvas, laserCanvas, videoWrapper);

  // Top bar elements
  const displayRoomCode = document.getElementById('display-room-code');
  const roleBadge = document.getElementById('role-badge');
  const sessionTimerEl = document.getElementById('session-timer');
  const recHud = document.getElementById('rec-hud');
  const recTimerEl = document.getElementById('rec-timer');

  // Dock buttons
  const btnToggleShare = document.getElementById('btn-toggle-share');
  const labelShareBtn = document.getElementById('label-share-btn');
  const btnToggleMic = document.getElementById('btn-toggle-mic');
  const iconMicOn = document.getElementById('icon-mic-on');
  const iconMicOff = document.getElementById('icon-mic-off');
  const btnToggleCam = document.getElementById('btn-toggle-cam');
  const iconCamOn = document.getElementById('icon-cam-on');
  const iconCamOff = document.getElementById('icon-cam-off');
  const btnDockTools = document.getElementById('btn-dock-tools');
  const annotationPopover = document.getElementById('annotation-popover');
  const btnToggleRecord = document.getElementById('btn-toggle-record');
  const labelRecBtn = document.getElementById('label-rec-btn');
  const recDotIcon = document.getElementById('rec-dot-icon');
  const btnDockSettings = document.getElementById('btn-dock-settings');

  // Header & Drawer buttons
  const btnRoomBadge = document.getElementById('btn-room-badge');
  const btnOpenInvite = document.getElementById('btn-open-invite');
  const btnToggleDrawer = document.getElementById('btn-toggle-drawer');
  const btnCloseDrawer = document.getElementById('btn-close-drawer');
  const btnLeaveSession = document.getElementById('btn-leave-session');

  // Stage overlay controls
  const emptyStageOverlay = document.getElementById('empty-stage-overlay');
  const emptyStageTitle = document.getElementById('empty-stage-title');
  const emptyStageDesc = document.getElementById('empty-stage-desc');
  const btnEmptyStartShare = document.getElementById('btn-empty-start-share');
  const btnStageSnapshot = document.getElementById('btn-stage-snapshot');
  const btnStageFullscreen = document.getElementById('btn-stage-fullscreen');
  const btnStageUnmute = document.getElementById('btn-stage-unmute');

  // Presenter Broadcasting Card & Local Preview Controls
  const presenterActiveCard = document.getElementById('presenter-active-card');
  const presentingViewerCount = document.getElementById('presenting-viewer-count');
  const btnToggleLocalPreview = document.getElementById('btn-toggle-local-preview');
  const previewToggleIcon = document.getElementById('preview-toggle-icon');
  const previewToggleLabel = document.getElementById('preview-toggle-label');
  const btnStopSharingCard = document.getElementById('btn-stop-sharing-card');
  const previewNoticeBadge = document.getElementById('preview-notice-badge');
  const btnHidePreviewBadge = document.getElementById('btn-hide-preview-badge');

  // Modals
  const modalInvite = document.getElementById('modal-invite');
  const btnCloseInvite = document.getElementById('btn-close-invite');
  const inviteDirectUrl = document.getElementById('invite-direct-url');
  const btnCopyDirectUrl = document.getElementById('btn-copy-direct-url');
  const modalDisplayCode = document.getElementById('modal-display-code');
  const qrCanvas = document.getElementById('qr-canvas');

  const modalRecording = document.getElementById('modal-recording');
  const btnCloseRecording = document.getElementById('btn-close-recording');
  const recordingPreviewVideo = document.getElementById('recording-preview-video');
  const recordingFilesize = document.getElementById('recording-filesize');
  const recordingDuration = document.getElementById('recording-duration');
  const btnDownloadRecording = document.getElementById('btn-download-recording');
  const btnDiscardRecording = document.getElementById('btn-discard-recording');

  const modalSettings = document.getElementById('modal-settings');
  const btnCloseSettings = document.getElementById('btn-close-settings');
  const settingResolution = document.getElementById('setting-resolution');

  // Chat & Reactions
  const chatForm = document.getElementById('chat-form');
  const chatInput = document.getElementById('chat-input');
  const btnRaiseHand = document.getElementById('btn-raise-hand');

  // Webcam PiP actions
  const btnPipShape = document.getElementById('btn-pip-shape');
  const btnPipMirror = document.getElementById('btn-pip-mirror');
  const btnPipClose = document.getElementById('btn-pip-close');

  // App State
  let sessionStartTime = null;
  let sessionTimerInterval = null;
  let isSharingScreen = false;
  let isMicActive = false;
  let isLocalPreviewActive = false;
  let activeRole = 'presenter'; // 'presenter' | 'viewer'
  let lanUrls = [];

  // ==========================================
  // 2. Fetch LAN Info & Handle Query Params
  // ==========================================
  try {
    const res = await fetch('/api/info');
    const info = await res.json();
    lanUrls = info.lanAddresses || [];
    const lanDisplay = document.getElementById('lan-url-display');
    const btnCopyLan = document.getElementById('btn-copy-lan');

    if (lanUrls.length > 0) {
      lanDisplay.textContent = lanUrls[0];
      btnCopyLan.onclick = () => {
        navigator.clipboard.writeText(lanUrls[0]);
        ui.showToast('Copied LAN URL: ' + lanUrls[0], 'success');
      };
    } else {
      lanDisplay.textContent = `http://${window.location.host}`;
    }
  } catch (err) {
    console.warn('Could not fetch server LAN info:', err);
  }

  // Connect Signaling WebSocket
  try {
    await webrtc.connect();
    const statusText = document.getElementById('lobby-connection-status');
    if (statusText) statusText.textContent = 'Server Connected';
  } catch (err) {
    ui.showToast('Failed to connect to signaling server', 'error');
  }

  // Auto-fill from URL query (?room=XYZ)
  const urlParams = new URLSearchParams(window.location.search);
  const roomParam = urlParams.get('room');
  if (roomParam) {
    joinRoomCodeInput.value = roomParam.toUpperCase();
    ui.showToast(`Joining room "${roomParam}" as Viewer`, 'info');
  }

  // ==========================================
  // 3. Lobby Form Submissions
  // ==========================================

  // Host Presentation
  formHost.addEventListener('submit', (e) => {
    e.preventDefault();
    const name = hostNameInput.value.trim() || 'Presenter';
    const customCode = customRoomCodeInput.value.trim();
    const quality = hostQualitySelect.value;
    settingResolution.value = quality;

    webrtc.createRoom(customCode, name);
  });

  // Join as Viewer
  formJoin.addEventListener('submit', (e) => {
    e.preventDefault();
    const code = joinRoomCodeInput.value.trim().toUpperCase();
    const name = viewerNameInput.value.trim() || 'Viewer';

    if (!code) {
      ui.showToast('Please enter a room code', 'warning');
      return;
    }

    webrtc.joinRoom(code, name);
  });

  // ==========================================
  // 4. WebRTC Events & State Transitions
  // ==========================================

  webrtc.onRoomCreated = (data) => {
    activeRole = 'presenter';
    enterStudio(data.roomId, 'HOST');
    ui.showToast(`Room ${data.roomId} created! Click "Share Screen" to broadcast.`, 'success');
  };

  webrtc.onRoomJoined = (data) => {
    activeRole = 'viewer';
    enterStudio(data.roomId, 'VIEWER');
    setupViewerMode(data);
    ui.showToast(`Connected to room ${data.roomId}`, 'success');
  };

  webrtc.onError = (message) => {
    ui.showToast(message, 'error');
  };

  webrtc.onPresenterLeft = (msg) => {
    ui.showToast(msg, 'warning', 6000);
    screenVideo.srcObject = null;
    showEmptyStage('Session Ended', 'The presenter has left the room.');
  };

  webrtc.onRemoteStream = (stream) => {
    const tracks = stream.getTracks();
    console.log('[App] onRemoteStream — tracks:', tracks.map(t => `${t.kind}:${t.readyState}:muted=${t.muted}`));

    const tapOverlay = document.getElementById('tap-to-play-overlay');

    // Always set srcObject (idempotent if same stream)
    if (screenVideo.srcObject !== stream) {
      console.log('[App] Setting srcObject on video element');
      screenVideo.srcObject = stream;
    }
    screenVideo.muted = true; // Required for autoplay on mobile

    const tryPlay = () => {
      const p = screenVideo.play();
      if (p !== undefined) {
        p.then(() => {
          console.log('[App] Video playing successfully');
          if (tapOverlay) tapOverlay.classList.add('hidden');
        }).catch(err => {
          console.warn('[App] Autoplay blocked:', err.name, '— showing tap overlay');
          if (tapOverlay) tapOverlay.classList.remove('hidden');
        });
      }
    };

    // Try immediately — also set up loadedmetadata fallback
    tryPlay();
    screenVideo.onloadedmetadata = () => {
      console.log('[App] Video metadata loaded, videoWidth:', screenVideo.videoWidth, 'videoHeight:', screenVideo.videoHeight);
      tryPlay();
    };

    hideEmptyStage();
    ui.showToast('Screen stream connected!', 'success');

    if (stream.getAudioTracks().length > 0 && btnStageUnmute) {
      btnStageUnmute.classList.remove('hidden');
    }
  };

  webrtc.onPresenterStatus = (isSharing) => {
    if (activeRole === 'viewer') {
      if (isSharing) {
        hideEmptyStage();
      } else {
        showEmptyStage('Screen Paused', 'Presenter has stopped sharing their screen.');
      }
    }
  };

  webrtc.onViewersUpdated = (count, viewers) => {
    ui.updateViewersList(viewers, count);
    if (presentingViewerCount) {
      presentingViewerCount.textContent = count === 1 ? '1 viewer' : `${count} viewers`;
    }
  };

  webrtc.onChatMessage = (msg) => {
    const isMine = msg.senderId === webrtc.clientId;
    ui.appendChatMessage(msg, isMine);
  };

  webrtc.onEmojiReaction = (reaction) => {
    ui.triggerReactionBurst(reaction.emoji);
  };

  webrtc.onHandRaised = (info) => {
    ui.showToast(`✋ ${info.senderName} raised their hand!`, 'info', 4000);
  };

  webrtc.onAnnotationReceived = (action, data) => {
    annotations.handleRemoteAction(action, data);
  };

  // Sync annotations drawn by presenter to viewers
  annotations.onSync = (action, data) => {
    if (activeRole === 'presenter') {
      webrtc.broadcastAnnotation(action, data);
    }
  };

  // ==========================================
  // 5. Studio Stage Setup & Mode Switching
  // ==========================================

  function enterStudio(roomId, roleText) {
    viewLobby.classList.remove('view-active');
    viewLobby.classList.add('view-hidden');

    viewStudio.classList.remove('view-hidden');
    viewStudio.classList.add('view-active');

    displayRoomCode.textContent = roomId;
    modalDisplayCode.textContent = roomId;
    roleBadge.textContent = roleText;
    document.getElementById('info-room-id').textContent = roomId;

    if (roleText === 'HOST') {
      roleBadge.className = 'badge badge-host';
    } else {
      roleBadge.className = 'badge badge-viewer';
    }

    // Direct Invite URL (Use LAN IP if available for cross-device support)
    const baseUrl = lanUrls.length > 0 ? lanUrls[0] : `${window.location.origin}`;
    const directUrl = `${baseUrl}?room=${roomId}`;
    inviteDirectUrl.value = directUrl;
    document.getElementById('info-lan-url').textContent = directUrl;

    // Render QR Code for quick mobile scanning
    ui.renderQRCode(qrCanvas, directUrl);

    // Start Session Duration Timer
    startSessionTimer();

    // Trigger canvas resize
    setTimeout(() => annotations.resize(), 100);
  }

  function setupViewerMode(roomData) {
    // Hide Presenter-only controls
    btnToggleShare.classList.add('hidden');
    btnToggleCam.classList.add('hidden');
    btnToggleRecord.classList.add('hidden');
    document.querySelector('.dock-tool-wrapper').classList.add('hidden');

    // Update empty stage message
    if (!roomData.isSharing) {
      showEmptyStage('Waiting for Presenter', 'The host has not started sharing their screen yet.');
    } else {
      hideEmptyStage();
    }
  }

  function showEmptyStage(title, desc) {
    emptyStageOverlay.classList.remove('hidden');
    emptyStageTitle.textContent = title;
    emptyStageDesc.textContent = desc;

    if (activeRole === 'viewer') {
      btnEmptyStartShare.classList.add('hidden');
    } else {
      btnEmptyStartShare.classList.remove('hidden');
    }
  }

  function hideEmptyStage() {
    emptyStageOverlay.classList.add('hidden');
  }

  function startSessionTimer() {
    sessionStartTime = Date.now();
    sessionTimerInterval = setInterval(() => {
      const elapsed = Math.floor((Date.now() - sessionStartTime) / 1000);
      const hours = Math.floor(elapsed / 3600);
      const mins = Math.floor((elapsed % 3600) / 60);
      const secs = elapsed % 60;
      sessionTimerEl.textContent = 
        `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    }, 1000);
  }

  // ==========================================
  // 6. Presenter Screen Sharing
  // ==========================================

  async function startScreenShare() {
    try {
      const quality = settingResolution.value;
      const captureSystem = document.getElementById('setting-system-audio').checked;

      const stream = await screen.startScreenCapture(quality, captureSystem);
      screenVideo.srcObject = stream;
      hideEmptyStage();

      isSharingScreen = true;
      btnToggleShare.classList.add('dock-btn-active');
      labelShareBtn.textContent = 'Stop Sharing';

      // Update WebRTC peers
      webrtc.updateActiveStream(stream);
      webrtc.updatePresenterStatus(true);

      // In Presenter mode: show Google Meet-style broadcast card to avoid infinity mirror feedback loop
      if (activeRole === 'presenter') {
        isLocalPreviewActive = false;
        if (presenterActiveCard) presenterActiveCard.classList.remove('hidden');
        if (previewNoticeBadge) previewNoticeBadge.classList.add('hidden');
        if (previewToggleIcon) previewToggleIcon.textContent = '👁️';
        if (previewToggleLabel) previewToggleLabel.textContent = 'Show Local Preview';
      }

      ui.showToast('Screen sharing is LIVE! Switch apps to present cleanly.', 'success', 5000);
    } catch (err) {
      if (err.name !== 'NotAllowedError') {
        ui.showToast('Could not access screen: ' + err.message, 'error');
      }
    }
  }

  function stopScreenShare() {
    screen.stop();
    screenVideo.srcObject = null;
    isSharingScreen = false;
    isLocalPreviewActive = false;

    btnToggleShare.classList.remove('dock-btn-active');
    labelShareBtn.textContent = 'Share Screen';

    if (presenterActiveCard) presenterActiveCard.classList.add('hidden');
    if (previewNoticeBadge) previewNoticeBadge.classList.add('hidden');

    showEmptyStage('Screen Share Stopped', 'Click "Share Screen" below to resume presenting.');
    webrtc.updateActiveStream(null);
    webrtc.updatePresenterStatus(false);
  }

  btnToggleShare.addEventListener('click', () => {
    if (isSharingScreen) {
      stopScreenShare();
    } else {
      startScreenShare();
    }
  });

  btnEmptyStartShare.addEventListener('click', () => {
    startScreenShare();
  });

  // Toggle local preview on presenter's screen
  if (btnToggleLocalPreview) {
    btnToggleLocalPreview.addEventListener('click', () => {
      isLocalPreviewActive = !isLocalPreviewActive;
      if (isLocalPreviewActive) {
        presenterActiveCard.classList.add('hidden');
        previewNoticeBadge.classList.remove('hidden');
        previewToggleIcon.textContent = '🙈';
        previewToggleLabel.textContent = 'Hide Local Preview';
        ui.showToast('Local preview enabled. Note: tunnel is normal when looking at this window.', 'info', 4500);
      } else {
        presenterActiveCard.classList.remove('hidden');
        previewNoticeBadge.classList.add('hidden');
        previewToggleIcon.textContent = '👁️';
        previewToggleLabel.textContent = 'Show Local Preview';
      }
    });
  }

  if (btnHidePreviewBadge) {
    btnHidePreviewBadge.addEventListener('click', () => {
      isLocalPreviewActive = false;
      presenterActiveCard.classList.remove('hidden');
      previewNoticeBadge.classList.add('hidden');
      previewToggleIcon.textContent = '👁️';
      previewToggleLabel.textContent = 'Show Local Preview';
    });
  }

  if (btnStopSharingCard) {
    btnStopSharingCard.addEventListener('click', () => {
      stopScreenShare();
    });
  }

  screen.onStreamEnded = () => {
    stopScreenShare();
  };

  // Audio VU meter update
  screen.onAudioLevel = (level) => {
    ui.updateMicVu(level);
  };

  // ==========================================
  // 7. Microphone Controls
  // ==========================================

  btnToggleMic.addEventListener('click', async () => {
    isMicActive = !isMicActive;
    const success = await screen.toggleMicrophone(isMicActive);

    if (success) {
      iconMicOn.classList.remove('hidden');
      iconMicOff.classList.add('hidden');
      btnToggleMic.classList.add('dock-btn-active');
      ui.showToast('Microphone unmuted', 'info');
    } else {
      iconMicOn.classList.add('hidden');
      iconMicOff.classList.remove('hidden');
      btnToggleMic.classList.remove('dock-btn-active');
      isMicActive = false;
      ui.showToast('Microphone muted', 'info');
    }

    // If screen is active, update peers with mixed audio
    if (isSharingScreen && screen.mixedStream) {
      webrtc.updateActiveStream(screen.mixedStream);
    }
  });

  // ==========================================
  // 8. Webcam PiP Controls
  // ==========================================

  btnToggleCam.addEventListener('click', async () => {
    if (webcam.isActive) {
      webcam.stop();
      iconCamOn.classList.remove('hidden');
      iconCamOff.classList.add('hidden');
      btnToggleCam.classList.remove('dock-btn-active');
      ui.showToast('Camera overlay off', 'info');
    } else {
      const started = await webcam.start();
      if (started) {
        iconCamOn.classList.add('hidden');
        iconCamOff.classList.remove('hidden');
        btnToggleCam.classList.add('dock-btn-active');
        ui.showToast('Camera PiP active (drag to move)', 'success');
      } else {
        ui.showToast('Could not access camera', 'warning');
      }
    }
  });

  btnPipShape.addEventListener('click', () => webcam.toggleShape());
  btnPipMirror.addEventListener('click', () => webcam.toggleMirror());
  btnPipClose.addEventListener('click', () => {
    webcam.stop();
    iconCamOn.classList.remove('hidden');
    iconCamOff.classList.add('hidden');
    btnToggleCam.classList.remove('dock-btn-active');
  });

  // ==========================================
  // 9. Annotation Tools Popover & Actions
  // ==========================================

  btnDockTools.addEventListener('click', (e) => {
    e.stopPropagation();
    annotationPopover.classList.toggle('hidden');
  });

  document.addEventListener('click', (e) => {
    if (!e.target.closest('.dock-tool-wrapper')) {
      annotationPopover.classList.add('hidden');
    }
  });

  const toolBtns = document.querySelectorAll('.tool-btn');
  toolBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      toolBtns.forEach(b => b.classList.remove('tool-active'));
      btn.classList.add('tool-active');
      annotations.setTool(btn.dataset.tool);

      if (btn.dataset.tool !== 'select') {
        btnDockTools.classList.add('dock-btn-active');
      } else {
        btnDockTools.classList.remove('dock-btn-active');
      }
    });
  });

  const colorSwatches = document.querySelectorAll('.color-swatch');
  colorSwatches.forEach((swatch) => {
    swatch.addEventListener('click', () => {
      colorSwatches.forEach(s => s.classList.remove('color-active'));
      swatch.classList.add('color-active');
      annotations.setColor(swatch.dataset.color);
    });
  });

  const strokeBtns = document.querySelectorAll('.stroke-btn');
  strokeBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      strokeBtns.forEach(b => b.classList.remove('stroke-active'));
      btn.classList.add('stroke-active');
      annotations.setStrokeWidth(btn.dataset.stroke);
    });
  });

  document.getElementById('btn-draw-undo').addEventListener('click', () => {
    annotations.undo();
  });

  document.getElementById('btn-draw-clear').addEventListener('click', () => {
    annotations.clear();
  });

  // ==========================================
  // 10. HD Session Recording
  // ==========================================

  btnToggleRecord.addEventListener('click', async () => {
    if (!recorder.isRecording) {
      const streamToRecord = screen.mixedStream || screen.screenStream;
      if (!streamToRecord) {
        ui.showToast('Please start screen sharing before recording', 'warning');
        return;
      }

      try {
        recorder.start(streamToRecord);
        recHud.classList.remove('hidden');
        btnToggleRecord.classList.add('dock-btn-danger-active', 'recording');
        labelRecBtn.textContent = 'Stop Rec';
        ui.showToast('HD Recording started', 'success');
      } catch (err) {
        ui.showToast('Recording error: ' + err.message, 'error');
      }
    } else {
      // Stop recording
      const result = await recorder.stop();
      recHud.classList.add('hidden');
      btnToggleRecord.classList.remove('dock-btn-danger-active', 'recording');
      labelRecBtn.textContent = 'Record';

      if (result) {
        lastRecordedBlob = result.blob;
        lastRecordedResult = result;

        // Reset cloud share UI
        if (uploadLinkResult) uploadLinkResult.classList.add('hidden');
        if (btnUploadCloudVideo) {
          btnUploadCloudVideo.disabled = false;
          btnUploadCloudVideo.innerHTML = '<span>Upload & Get Link</span>';
        }

        // Open Recording Export Modal
        recordingPreviewVideo.src = result.url;
        recordingFilesize.textContent = `File Size: ${result.size}`;
        recordingDuration.textContent = `Duration: ${result.duration}`;
        btnDownloadRecording.href = result.url;
        modalRecording.showModal();
      }
    }
  });

  recorder.onTick = (timeStr) => {
    recTimerEl.textContent = timeStr;
  };

  btnCloseRecording.addEventListener('click', () => modalRecording.close());
  btnDiscardRecording.addEventListener('click', () => modalRecording.close());

  // Cloud Video Upload (Loom SaaS Feature)
  let lastRecordedBlob = null;
  let lastRecordedResult = null;
  const btnUploadCloudVideo = document.getElementById('btn-upload-cloud-video');
  const uploadLinkResult = document.getElementById('upload-link-result');
  const generatedVideoUrl = document.getElementById('generated-video-url');
  const btnCopyVideoLink = document.getElementById('btn-copy-video-link');
  const btnOpenWatchPage = document.getElementById('btn-open-watch-page');

  if (btnUploadCloudVideo) {
    btnUploadCloudVideo.addEventListener('click', async () => {
      if (!lastRecordedBlob) {
        ui.showToast('No recording available to upload', 'warning');
        return;
      }

      btnUploadCloudVideo.disabled = true;
      btnUploadCloudVideo.innerHTML = '<span>Uploading to Cloud...</span>';

      const formData = new FormData();
      formData.append('video', lastRecordedBlob, 'screen-record.webm');
      formData.append('duration', lastRecordedResult?.duration || '00:00');
      formData.append('size', lastRecordedResult?.size || '0 MB');

      try {
        const res = await fetch('/api/videos/upload', {
          method: 'POST',
          body: formData
        });
        const data = await res.json();
        if (data.success) {
          generatedVideoUrl.value = data.shareUrl;
          btnOpenWatchPage.href = data.url;
          uploadLinkResult.classList.remove('hidden');
          btnUploadCloudVideo.innerHTML = '<span>✓ Cloud Link Ready!</span>';
          ui.showToast('Cloud share link generated! Ready to share.', 'success');
        } else {
          throw new Error(data.error || 'Upload failed');
        }
      } catch (err) {
        ui.showToast('Upload error: ' + err.message, 'error');
        btnUploadCloudVideo.disabled = false;
        btnUploadCloudVideo.innerHTML = '<span>Upload & Get Link</span>';
      }
    });
  }

  if (btnCopyVideoLink) {
    btnCopyVideoLink.addEventListener('click', () => {
      navigator.clipboard.writeText(generatedVideoUrl.value);
      ui.showToast('Public video watch link copied!', 'success');
    });
  }

  // ==========================================
  // 11. Razorpay Pricing & Subscription Checkout
  // ==========================================

  const modalPricing = document.getElementById('modal-pricing');
  const btnClosePricing = document.getElementById('btn-close-pricing');
  const btnOpenPricingLobby = document.getElementById('btn-open-pricing-lobby');
  const btnOpenPricingStudio = document.getElementById('btn-open-pricing-studio');
  const btnBuyPro = document.getElementById('btn-buy-pro');
  const btnBuyTeam = document.getElementById('btn-buy-team');

  if (btnOpenPricingLobby) btnOpenPricingLobby.addEventListener('click', () => modalPricing.showModal());
  if (btnOpenPricingStudio) btnOpenPricingStudio.addEventListener('click', () => modalPricing.showModal());
  if (btnClosePricing) btnClosePricing.addEventListener('click', () => modalPricing.close());

  async function handleRazorpayCheckout(planId) {
    try {
      ui.showToast('Connecting to Razorpay gateway...', 'info');
      const res = await fetch('/api/billing/create-order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ planId })
      });
      const orderData = await res.json();

      const options = {
        key: orderData.keyId,
        amount: orderData.order.amount,
        currency: orderData.order.currency,
        name: 'AeroShare Pro',
        description: planId === 'team_annual' ? 'Team Workspace Subscription' : 'Pro Monthly Subscription',
        image: '/assets/favicon.svg',
        order_id: orderData.order.id,
        theme: { color: '#06b6d4' },
        handler: async function (response) {
          const verifyRes = await fetch('/api/billing/verify-payment', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...response, planId })
          });
          const verifyData = await verifyRes.json();
          modalPricing.close();
          ui.showToast(verifyData.message, 'success', 7000);
          if (btnOpenPricingLobby) btnOpenPricingLobby.textContent = '👑 PRO ACTIVE';
          if (btnOpenPricingStudio) btnOpenPricingStudio.textContent = '👑 PRO';
        },
        modal: {
          ondismiss: function () {
            ui.showToast('Checkout window closed', 'info');
          }
        }
      };

      if (window.Razorpay && !orderData.isDemo) {
        const rzp = new Razorpay(options);
        rzp.open();
      } else {
        // Local interactive demo simulation
        setTimeout(async () => {
          const verifyRes = await fetch('/api/billing/verify-payment', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ razorpay_payment_id: 'pay_demo_success', planId })
          });
          const verifyData = await verifyRes.json();
          modalPricing.close();
          ui.showToast(verifyData.message, 'success', 7000);
          if (btnOpenPricingLobby) btnOpenPricingLobby.textContent = '👑 PRO ACTIVE';
          if (btnOpenPricingStudio) btnOpenPricingStudio.textContent = '👑 PRO';
        }, 800);
      }
    } catch (err) {
      ui.showToast('Payment initialization error: ' + err.message, 'error');
    }
  }

  if (btnBuyPro) btnBuyPro.addEventListener('click', () => handleRazorpayCheckout('pro_monthly'));
  if (btnBuyTeam) btnBuyTeam.addEventListener('click', () => handleRazorpayCheckout('team_annual'));

  // ==========================================
  // 12. Chat & Reactions
  // ==========================================

  chatForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = chatInput.value.trim();
    if (!text) return;
    webrtc.sendChatMessage(text);
    chatInput.value = '';
  });

  const emojiBtns = document.querySelectorAll('.emoji-btn');
  emojiBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      const emoji = btn.dataset.emoji;
      webrtc.sendEmojiReaction(emoji);
      ui.triggerReactionBurst(emoji);
    });
  });

  btnRaiseHand.addEventListener('click', () => {
    webrtc.raiseHand();
    ui.showToast('✋ You raised your hand!', 'info');
  });

  // ==========================================
  // 12. Stage Overlays, Modals & Navigation
  // ==========================================

  btnStageSnapshot.addEventListener('click', () => {
    ui.takeSnapshot(screenVideo, annotationCanvas);
  });

  btnStageFullscreen.addEventListener('click', () => {
    ui.toggleFullscreen(videoWrapper);
  });

  if (btnStageUnmute) {
    btnStageUnmute.addEventListener('click', () => {
      screenVideo.muted = !screenVideo.muted;
      if (screenVideo.muted) {
        btnStageUnmute.classList.remove('dock-btn-active');
        ui.showToast('Stream audio muted', 'info');
      } else {
        btnStageUnmute.classList.add('dock-btn-active');
        ui.showToast('Stream audio unmuted', 'success');
      }
    });
  }

  // Tap-to-play overlay for mobile autoplay restrictions
  const tapToPlayOverlay = document.getElementById('tap-to-play-overlay');
  const btnTapToPlay = document.getElementById('btn-tap-to-play');
  if (btnTapToPlay && tapToPlayOverlay) {
    btnTapToPlay.addEventListener('click', () => {
      screenVideo.muted = true; // Must be muted for autoplay
      screenVideo.play().then(() => {
        tapToPlayOverlay.classList.add('hidden');
        ui.showToast('Stream playing! Tap 🔊 to unmute audio.', 'success');
      }).catch(err => {
        console.error('[App] Could not play video:', err);
      });
    });
  }

  // Hide tap overlay when video starts playing naturally
  screenVideo.addEventListener('playing', () => {
    if (tapToPlayOverlay) tapToPlayOverlay.classList.add('hidden');
  });

  // Drawer Toggle
  btnToggleDrawer.addEventListener('click', () => ui.toggleDrawer());
  btnCloseDrawer.addEventListener('click', () => ui.toggleDrawer(false));

  // Room Badge 1-click Copy
  btnRoomBadge.addEventListener('click', () => {
    const url = inviteDirectUrl.value;
    navigator.clipboard.writeText(url);
    ui.showToast('Copied room invite link to clipboard!', 'success');
  });

  // Invite Modal
  btnOpenInvite.addEventListener('click', () => modalInvite.showModal());
  btnCloseInvite.addEventListener('click', () => modalInvite.close());
  btnCopyDirectUrl.addEventListener('click', () => {
    navigator.clipboard.writeText(inviteDirectUrl.value);
    ui.showToast('Invite link copied!', 'success');
  });

  // Settings Modal
  btnDockSettings.addEventListener('click', () => modalSettings.showModal());
  btnCloseSettings.addEventListener('click', () => modalSettings.close());

  // Leave Session
  btnLeaveSession.addEventListener('click', () => {
    if (confirm('Are you sure you want to exit this session?')) {
      if (recorder.isRecording) recorder.stop();
      screen.stop();
      webcam.stop();
      webrtc.leave();
      if (sessionTimerInterval) clearInterval(sessionTimerInterval);
      window.location.href = window.location.pathname; // Reload to clean lobby
    }
  });
});
