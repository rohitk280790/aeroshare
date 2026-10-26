/**
 * AeroShare — Draggable Webcam Picture-in-Picture (PiP) Controller
 */

class WebcamManager {
  constructor(pipEl, videoEl, dragHandleEl, containerEl) {
    this.pip = pipEl;
    this.video = videoEl;
    this.dragHandle = dragHandleEl;
    this.container = containerEl;

    this.stream = null;
    this.isActive = false;
    this.isCircular = false;
    this.isMirrored = true;

    this.isDragging = false;
    this.dragOffset = { x: 0, y: 0 };

    this.initDrag();
  }

  async start() {
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 640 },
          height: { ideal: 480 },
          frameRate: { ideal: 30 }
        },
        audio: false
      });

      this.video.srcObject = this.stream;
      this.pip.classList.remove('hidden');
      this.isActive = true;
      return true;
    } catch (err) {
      console.error('[Webcam] getUserMedia error:', err);
      return false;
    }
  }

  stop() {
    if (this.stream) {
      this.stream.getTracks().forEach(t => t.stop());
      this.stream = null;
    }
    this.video.srcObject = null;
    this.pip.classList.add('hidden');
    this.isActive = false;
  }

  toggleShape() {
    this.isCircular = !this.isCircular;
    if (this.isCircular) {
      this.pip.classList.add('pip-circular');
    } else {
      this.pip.classList.remove('pip-circular');
    }
  }

  toggleMirror() {
    this.isMirrored = !this.isMirrored;
    if (this.isMirrored) {
      this.video.classList.remove('unmirrored');
    } else {
      this.video.classList.add('unmirrored');
    }
  }

  initDrag() {
    // Pointer down on handle (or on pip itself if circular)
    const onStart = (e) => {
      this.isDragging = true;
      const rect = this.pip.getBoundingClientRect();
      const parentRect = this.container.getBoundingClientRect();

      this.dragOffset.x = e.clientX - rect.left;
      this.dragOffset.y = e.clientY - rect.top;

      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onEnd);
      window.addEventListener('pointercancel', onEnd);
    };

    const onMove = (e) => {
      if (!this.isDragging) return;

      const parentRect = this.container.getBoundingClientRect();
      const pipW = this.pip.offsetWidth;
      const pipH = this.pip.offsetHeight;

      let left = e.clientX - parentRect.left - this.dragOffset.x;
      let top = e.clientY - parentRect.top - this.dragOffset.y;

      // Constrain within container bounds
      left = Math.max(0, Math.min(parentRect.width - pipW, left));
      top = Math.max(0, Math.min(parentRect.height - pipH, top));

      this.pip.style.left = `${left}px`;
      this.pip.style.top = `${top}px`;
      this.pip.style.right = 'auto';
      this.pip.style.bottom = 'auto';
    };

    const onEnd = () => {
      this.isDragging = false;
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onEnd);
      window.removeEventListener('pointercancel', onEnd);
    };

    this.dragHandle.addEventListener('pointerdown', onStart);
    // Also allow dragging by body when in circular mode
    this.pip.addEventListener('pointerdown', (e) => {
      if (this.isCircular && !e.target.closest('.pip-btn')) {
        onStart(e);
      }
    });
  }
}

window.WebcamManager = WebcamManager;
