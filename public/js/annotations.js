/**
 * RoKaShare — Live Canvas Annotations & Laser Pointer Engine
 */

class AnnotationEngine {
  constructor(canvasEl, laserCanvasEl, wrapperEl) {
    this.canvas = canvasEl;
    this.ctx = canvasEl.getContext('2d');
    this.laserCanvas = laserCanvasEl;
    this.laserCtx = laserCanvasEl.getContext('2d');
    this.wrapper = wrapperEl;

    this.activeTool = 'select'; // select, laser, pen, highlighter, arrow, rect, eraser
    this.activeColor = '#ec4899';
    this.strokeWidth = 3;

    this.isDrawing = false;
    this.currentPath = null;
    this.shapes = []; // Persistent shapes
    this.undoStack = [];

    // Laser particle trail
    this.laserTrail = [];
    this.laserRafId = null;
    this.isLaserActive = false;

    // Callback to sync with peers
    this.onSync = () => {};

    this.init();
  }

  init() {
    this.resize();
    window.addEventListener('resize', () => this.resize());

    // Mouse / Touch event listeners on canvas
    this.canvas.addEventListener('pointerdown', (e) => this.handlePointerDown(e));
    this.canvas.addEventListener('pointermove', (e) => this.handlePointerMove(e));
    this.canvas.addEventListener('pointerup', (e) => this.handlePointerUp(e));
    this.canvas.addEventListener('pointercancel', (e) => this.handlePointerUp(e));

    // Laser canvas event listeners
    this.laserCanvas.addEventListener('pointermove', (e) => this.handleLaserMove(e));
    this.laserCanvas.addEventListener('pointerleave', () => this.handleLaserLeave());

    this.startLaserLoop();
  }

  resize() {
    const rect = this.wrapper.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;

    this.canvas.width = rect.width * dpr;
    this.canvas.height = rect.height * dpr;
    this.ctx.resetTransform();
    this.ctx.scale(dpr, dpr);

    this.laserCanvas.width = rect.width * dpr;
    this.laserCanvas.height = rect.height * dpr;
    this.laserCtx.resetTransform();
    this.laserCtx.scale(dpr, dpr);

    this.redrawAll();
  }

  setTool(tool) {
    this.activeTool = tool;
    const body = document.querySelector('.stage-viewport');

    body.classList.remove('drawing-active', 'laser-active');
    if (tool === 'laser') {
      body.classList.add('laser-active');
    } else if (tool !== 'select') {
      body.classList.add('drawing-active');
    }
  }

  setColor(color) {
    this.activeColor = color;
  }

  setStrokeWidth(width) {
    this.strokeWidth = parseInt(width, 10) || 3;
  }

  // Convert client coordinates to normalized (0.0 to 1.0) coordinates
  getNormalizedCoords(e) {
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)),
      y: Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height))
    };
  }

  // Denormalize for rendering on local canvas
  toCanvasCoords(normPt) {
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: normPt.x * rect.width,
      y: normPt.y * rect.height
    };
  }

  handlePointerDown(e) {
    if (this.activeTool === 'select' || this.activeTool === 'laser') return;

    this.isDrawing = true;
    const pt = this.getNormalizedCoords(e);

    if (this.activeTool === 'pen' || this.activeTool === 'highlighter') {
      this.currentPath = {
        id: 'shape_' + Date.now(),
        tool: this.activeTool,
        color: this.activeColor,
        strokeWidth: this.activeTool === 'highlighter' ? this.strokeWidth * 4 : this.strokeWidth,
        points: [pt]
      };
    } else if (this.activeTool === 'arrow' || this.activeTool === 'rect') {
      this.currentPath = {
        id: 'shape_' + Date.now(),
        tool: this.activeTool,
        color: this.activeColor,
        strokeWidth: this.strokeWidth,
        start: pt,
        end: pt
      };
    } else if (this.activeTool === 'eraser') {
      this.eraseNear(pt);
    }
  }

  handlePointerMove(e) {
    if (!this.isDrawing) return;
    const pt = this.getNormalizedCoords(e);

    if (this.activeTool === 'pen' || this.activeTool === 'highlighter') {
      this.currentPath.points.push(pt);
      this.redrawAll();
      this.drawShape(this.currentPath);
    } else if (this.activeTool === 'arrow' || this.activeTool === 'rect') {
      this.currentPath.end = pt;
      this.redrawAll();
      this.drawShape(this.currentPath);
    } else if (this.activeTool === 'eraser') {
      this.eraseNear(pt);
    }
  }

  handlePointerUp(e) {
    if (!this.isDrawing) return;
    this.isDrawing = false;

    if (this.currentPath) {
      this.shapes.push(this.currentPath);
      this.onSync('add-shape', this.currentPath);
      this.currentPath = null;
      this.redrawAll();
    }
  }

  eraseNear(normPt) {
    const threshold = 0.04;
    const prevLen = this.shapes.length;
    this.shapes = this.shapes.filter((s) => {
      if (s.points) {
        return !s.points.some((p) => Math.hypot(p.x - normPt.x, p.y - normPt.y) < threshold);
      }
      if (s.start && s.end) {
        const midX = (s.start.x + s.end.x) / 2;
        const midY = (s.start.y + s.end.y) / 2;
        return Math.hypot(midX - normPt.x, midY - normPt.y) >= threshold;
      }
      return true;
    });

    if (this.shapes.length !== prevLen) {
      this.redrawAll();
      this.onSync('set-shapes', this.shapes);
    }
  }

  undo() {
    if (this.shapes.length > 0) {
      this.shapes.pop();
      this.redrawAll();
      this.onSync('set-shapes', this.shapes);
    }
  }

  clear() {
    this.shapes = [];
    this.currentPath = null;
    this.redrawAll();
    this.onSync('clear-all', {});
  }

  redrawAll() {
    const rect = this.canvas.getBoundingClientRect();
    this.ctx.clearRect(0, 0, rect.width, rect.height);

    for (const shape of this.shapes) {
      this.drawShape(shape);
    }
  }

  drawShape(shape) {
    if (!shape) return;
    this.ctx.save();

    if (shape.tool === 'highlighter') {
      this.ctx.globalAlpha = 0.35;
      this.ctx.lineCap = 'square';
    } else {
      this.ctx.globalAlpha = 1.0;
      this.ctx.lineCap = 'round';
    }

    this.ctx.strokeStyle = shape.color;
    this.ctx.fillStyle = shape.color;
    this.ctx.lineWidth = shape.strokeWidth;
    this.ctx.lineJoin = 'round';

    if ((shape.tool === 'pen' || shape.tool === 'highlighter') && shape.points && shape.points.length > 0) {
      this.ctx.beginPath();
      const first = this.toCanvasCoords(shape.points[0]);
      this.ctx.moveTo(first.x, first.y);

      for (let i = 1; i < shape.points.length; i++) {
        const p = this.toCanvasCoords(shape.points[i]);
        this.ctx.lineTo(p.x, p.y);
      }
      this.ctx.stroke();
    } else if (shape.tool === 'rect' && shape.start && shape.end) {
      const p1 = this.toCanvasCoords(shape.start);
      const p2 = this.toCanvasCoords(shape.end);
      const w = p2.x - p1.x;
      const h = p2.y - p1.y;

      this.ctx.beginPath();
      this.ctx.strokeRect(p1.x, p1.y, w, h);
    } else if (shape.tool === 'arrow' && shape.start && shape.end) {
      const p1 = this.toCanvasCoords(shape.start);
      const p2 = this.toCanvasCoords(shape.end);

      // Main line
      this.ctx.beginPath();
      this.ctx.moveTo(p1.x, p1.y);
      this.ctx.lineTo(p2.x, p2.y);
      this.ctx.stroke();

      // Arrow head
      const angle = Math.atan2(p2.y - p1.y, p2.x - p1.x);
      const headLen = Math.max(14, shape.strokeWidth * 3);

      this.ctx.beginPath();
      this.ctx.moveTo(p2.x, p2.y);
      this.ctx.lineTo(p2.x - headLen * Math.cos(angle - Math.PI / 6), p2.y - headLen * Math.sin(angle - Math.PI / 6));
      this.ctx.lineTo(p2.x - headLen * Math.cos(angle + Math.PI / 6), p2.y - headLen * Math.sin(angle + Math.PI / 6));
      this.ctx.closePath();
      this.ctx.fill();
    }

    this.ctx.restore();
  }

  // ==========================================
  // Laser Pointer Engine
  // ==========================================

  handleLaserMove(e) {
    if (this.activeTool !== 'laser') return;
    const pt = this.getNormalizedCoords(e);
    this.addLaserPoint(pt);
    this.onSync('laser-point', pt);
  }

  handleLaserLeave() {
    this.onSync('laser-end', {});
  }

  addLaserPoint(normPt) {
    const now = Date.now();
    this.laserTrail.push({
      x: normPt.x,
      y: normPt.y,
      birth: now
    });
  }

  startLaserLoop() {
    const loop = () => {
      this.renderLaser();
      this.laserRafId = requestAnimationFrame(loop);
    };
    this.laserRafId = requestAnimationFrame(loop);
  }

  renderLaser() {
    const rect = this.laserCanvas.getBoundingClientRect();
    this.laserCtx.clearRect(0, 0, rect.width, rect.height);

    const now = Date.now();
    const lifespan = 500; // ms

    // Filter alive particles
    this.laserTrail = this.laserTrail.filter(p => now - p.birth < lifespan);

    if (this.laserTrail.length === 0) return;

    // Draw fading trail
    for (let i = 0; i < this.laserTrail.length; i++) {
      const p = this.laserTrail[i];
      const age = now - p.birth;
      const progress = 1 - (age / lifespan);
      const canvasPt = this.toCanvasCoords(p);

      this.laserCtx.beginPath();
      this.laserCtx.arc(canvasPt.x, canvasPt.y, 6 * progress, 0, Math.PI * 2);
      this.laserCtx.fillStyle = `rgba(244, 63, 94, ${0.8 * progress})`;
      this.laserCtx.shadowColor = '#f43f5e';
      this.laserCtx.shadowBlur = 12;
      this.laserCtx.fill();
    }

    // Glowing head
    const head = this.laserTrail[this.laserTrail.length - 1];
    const headPt = this.toCanvasCoords(head);

    this.laserCtx.beginPath();
    this.laserCtx.arc(headPt.x, headPt.y, 8, 0, Math.PI * 2);
    this.laserCtx.fillStyle = '#ffffff';
    this.laserCtx.shadowColor = '#ff2b56';
    this.laserCtx.shadowBlur = 18;
    this.laserCtx.fill();

    this.laserCtx.beginPath();
    this.laserCtx.arc(headPt.x, headPt.y, 14, 0, Math.PI * 2);
    this.laserCtx.fillStyle = 'rgba(244, 63, 94, 0.4)';
    this.laserCtx.fill();
  }

  // ==========================================
  // Remote Synchronization Receiver (Viewer side)
  // ==========================================

  handleRemoteAction(action, data) {
    switch (action) {
      case 'add-shape':
        this.shapes.push(data);
        this.redrawAll();
        break;

      case 'set-shapes':
        this.shapes = data || [];
        this.redrawAll();
        break;

      case 'clear-all':
        this.clear();
        break;

      case 'laser-point':
        this.addLaserPoint(data);
        break;

      case 'laser-end':
        this.laserTrail = [];
        break;
    }
  }
}

window.AnnotationEngine = AnnotationEngine;
