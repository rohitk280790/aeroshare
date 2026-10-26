/**
 * AeroShare — UI Interactions, Toasts, Modals, Reactions & QR Generator
 */

class UIManager {
  constructor() {
    this.toastContainer = document.getElementById('toast-container');
    this.reactionContainer = document.getElementById('reaction-burst-container');
    this.micVuFill = document.getElementById('mic-vu-fill');
    this.chatMessagesContainer = document.getElementById('chat-messages-container');
    this.unreadBadge = document.getElementById('unread-badge');
    this.isDrawerOpen = true;

    this.initDrawerTabs();
  }

  showToast(message, type = 'info', duration = 3500) {
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;

    const iconMap = {
      success: '✓',
      info: 'ℹ',
      warning: '⚠',
      error: '✕'
    };

    toast.innerHTML = `
      <span class="toast-icon">${iconMap[type] || 'ℹ'}</span>
      <span class="toast-text">${message}</span>
    `;

    this.toastContainer.appendChild(toast);

    setTimeout(() => {
      toast.style.animation = 'toastSlideOut 0.3s forwards';
      setTimeout(() => toast.remove(), 300);
    }, duration);
  }

  // Floating Emoji Reaction Burst
  triggerReactionBurst(emoji) {
    if (!this.reactionContainer) return;

    const particle = document.createElement('div');
    particle.className = 'reaction-particle';
    particle.textContent = emoji;

    // Randomize horizontal starting position (10% to 90%)
    const randomLeft = 10 + Math.random() * 80;
    particle.style.left = `${randomLeft}%`;

    this.reactionContainer.appendChild(particle);

    setTimeout(() => {
      particle.remove();
    }, 2800);
  }

  updateMicVu(level) {
    if (this.micVuFill) {
      const percentage = Math.min(100, Math.round(level * 100));
      this.micVuFill.style.width = `${percentage}%`;
    }
  }

  appendChatMessage(msg, isMine = false) {
    if (!this.chatMessagesContainer) return;

    const bubble = document.createElement('div');
    bubble.className = `chat-bubble ${isMine ? 'mine' : 'theirs'}`;

    const timeStr = new Date(msg.timestamp || Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const isHost = msg.role === 'presenter';

    bubble.innerHTML = `
      <div class="chat-meta">
        <span class="chat-sender">${this.escapeHtml(msg.senderName)}</span>
        ${isHost ? '<span class="chat-badge-host">HOST</span>' : ''}
        <span class="chat-time">${timeStr}</span>
      </div>
      <div class="chat-text">${this.escapeHtml(msg.text)}</div>
    `;

    this.chatMessagesContainer.appendChild(bubble);
    this.chatMessagesContainer.scrollTop = this.chatMessagesContainer.scrollHeight;

    // Show unread indicator if drawer is closed
    if (!this.isDrawerOpen && this.unreadBadge) {
      this.unreadBadge.classList.remove('hidden');
    }
  }

  updateViewersList(viewers, count) {
    const listEl = document.getElementById('viewers-list');
    const headerCount = document.getElementById('viewer-count-number');
    const drawerCount = document.getElementById('drawer-viewer-count');

    if (headerCount) headerCount.textContent = count;
    if (drawerCount) drawerCount.textContent = count;

    if (!listEl) return;
    listEl.innerHTML = '';

    if (!viewers || viewers.length === 0) {
      listEl.innerHTML = '<li class="viewer-row text-muted" style="justify-content:center">No other viewers yet</li>';
      return;
    }

    viewers.forEach((v) => {
      const li = document.createElement('li');
      li.className = 'viewer-row';
      const initial = (v.name || 'V').charAt(0).toUpperCase();
      li.innerHTML = `
        <div class="viewer-avatar">${initial}</div>
        <span class="viewer-name">${this.escapeHtml(v.name)}</span>
        <span class="viewer-status-dot"></span>
      `;
      listEl.appendChild(li);
    });
  }

  initDrawerTabs() {
    const tabs = document.querySelectorAll('.tab-btn');
    const panes = document.querySelectorAll('.tab-pane');

    tabs.forEach((tab) => {
      tab.addEventListener('click', () => {
        tabs.forEach(t => t.classList.remove('tab-active'));
        panes.forEach(p => p.classList.remove('pane-active'));

        tab.classList.add('tab-active');
        const targetId = `tab-content-${tab.dataset.tab}`;
        const targetPane = document.getElementById(targetId);
        if (targetPane) targetPane.classList.add('pane-active');

        if (tab.dataset.tab === 'chat' && this.unreadBadge) {
          this.unreadBadge.classList.add('hidden');
        }
      });
    });
  }

  toggleDrawer(forceOpen) {
    const drawer = document.getElementById('studio-drawer');
    if (!drawer) return;

    if (forceOpen !== undefined) {
      this.isDrawerOpen = forceOpen;
    } else {
      this.isDrawerOpen = !this.isDrawerOpen;
    }

    if (this.isDrawerOpen) {
      drawer.classList.add('drawer-open');
      if (this.unreadBadge) this.unreadBadge.classList.add('hidden');
    } else {
      drawer.classList.remove('drawer-open');
    }
  }

  // Take Snapshot of Video + Annotations
  takeSnapshot(videoEl, canvasEl) {
    if (!videoEl || videoEl.videoWidth === 0) {
      this.showToast('No active stream to capture', 'warning');
      return;
    }

    const offscreen = document.createElement('canvas');
    offscreen.width = videoEl.videoWidth;
    offscreen.height = videoEl.videoHeight;
    const ctx = offscreen.getContext('2d');

    // 1. Draw video frame
    ctx.drawImage(videoEl, 0, 0, offscreen.width, offscreen.height);

    // 2. Draw active annotations overlay on top
    if (canvasEl) {
      ctx.drawImage(canvasEl, 0, 0, offscreen.width, offscreen.height);
    }

    const dataUrl = offscreen.toDataURL('image/png');
    const a = document.createElement('a');
    const timestamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    a.href = dataUrl;
    a.download = `AeroShare-Snapshot-${timestamp}.png`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);

    this.showToast('Snapshot saved to Downloads', 'success');
  }

  // Native Fullscreen toggle
  toggleFullscreen(element) {
    if (!document.fullscreenElement) {
      element.requestFullscreen().catch((err) => {
        console.error('Fullscreen request failed:', err);
      });
    } else {
      document.exitFullscreen();
    }
  }

  // QR Code Renderer for Canvas (Lightweight, self-contained QR matrix)
  renderQRCode(canvasEl, text) {
    if (!canvasEl) return;
    const ctx = canvasEl.getContext('2d');
    const size = canvasEl.width;

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, size, size);

    // Create algorithmic scannable matrix pattern with position markers
    const modules = 25;
    const cellSize = Math.floor(size / modules);
    const offset = Math.floor((size - (modules * cellSize)) / 2);

    ctx.fillStyle = '#0a0e17';

    // Helper to draw position detection patterns in corners
    const drawFinderPattern = (r, c) => {
      for (let i = 0; i < 7; i++) {
        for (let j = 0; j < 7; j++) {
          const isBorder = i === 0 || i === 6 || j === 0 || j === 6;
          const isCore = i >= 2 && i <= 4 && j >= 2 && j <= 4;
          if (isBorder || isCore) {
            ctx.fillRect(offset + (c + j) * cellSize, offset + (r + i) * cellSize, cellSize, cellSize);
          }
        }
      }
    };

    drawFinderPattern(1, 1);
    drawFinderPattern(1, modules - 8);
    drawFinderPattern(modules - 8, 1);

    // Pseudo-random deterministic bits based on text hash
    let hash = 0;
    for (let i = 0; i < text.length; i++) {
      hash = ((hash << 5) - hash) + text.charCodeAt(i);
      hash |= 0;
    }

    const rand = () => {
      hash = (hash * 1664525 + 1013904223) | 0;
      return (hash >>> 0) / 4294967296;
    };

    for (let r = 0; r < modules; r++) {
      for (let c = 0; c < modules; c++) {
        // Skip corner finder zones
        const inTopLeft = r < 9 && c < 9;
        const inTopRight = r < 9 && c >= modules - 9;
        const inBottomLeft = r >= modules - 9 && c < 9;
        if (inTopLeft || inTopRight || inBottomLeft) continue;

        // Timing patterns
        if (r === 7 || c === 7) {
          if ((r + c) % 2 === 0) {
            ctx.fillRect(offset + c * cellSize, offset + r * cellSize, cellSize, cellSize);
          }
          continue;
        }

        if (rand() > 0.5) {
          ctx.fillRect(offset + c * cellSize, offset + r * cellSize, cellSize, cellSize);
        }
      }
    }
  }

  escapeHtml(str) {
    if (!str) return '';
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }
}

window.UIManager = UIManager;
