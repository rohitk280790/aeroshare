/**
 * RoKaShare — HD Screen & Audio Session Recorder
 */

class SessionRecorder {
  constructor() {
    this.mediaRecorder = null;
    this.recordedChunks = [];
    this.isRecording = false;
    this.isPaused = false;
    this.startTime = null;
    this.pauseStartTime = null;
    this.totalPausedDuration = 0;
    this.timerInterval = null;

    this.onTick = () => {}; // Formatted time string
    this.onStateChange = () => {};
  }

  getSupportedMimeType() {
    const types = [
      'video/webm;codecs=vp9,opus',
      'video/webm;codecs=vp8,opus',
      'video/webm',
      'video/mp4'
    ];
    for (const t of types) {
      if (MediaRecorder.isTypeSupported(t)) {
        return t;
      }
    }
    return '';
  }

  start(stream) {
    if (!stream) {
      throw new Error('No active stream provided for recording');
    }

    this.recordedChunks = [];
    const mimeType = this.getSupportedMimeType();
    const options = {
      mimeType,
      videoBitsPerSecond: 5000000 // 5 Mbps HD quality
    };

    try {
      this.mediaRecorder = new MediaRecorder(stream, options);
    } catch (e) {
      console.warn('Fallback to default MediaRecorder options:', e);
      this.mediaRecorder = new MediaRecorder(stream);
    }

    this.mediaRecorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) {
        this.recordedChunks.push(event.data);
      }
    };

    this.mediaRecorder.start(1000); // chunk every 1s
    this.isRecording = true;
    this.isPaused = false;
    this.startTime = Date.now();
    this.totalPausedDuration = 0;

    this.startTimer();
    this.onStateChange({ isRecording: true, isPaused: false });
  }

  pause() {
    if (this.mediaRecorder && this.mediaRecorder.state === 'recording') {
      this.mediaRecorder.pause();
      this.isPaused = true;
      this.pauseStartTime = Date.now();
      this.onStateChange({ isRecording: true, isPaused: true });
    }
  }

  resume() {
    if (this.mediaRecorder && this.mediaRecorder.state === 'paused') {
      this.mediaRecorder.resume();
      this.isPaused = false;
      if (this.pauseStartTime) {
        this.totalPausedDuration += Date.now() - this.pauseStartTime;
        this.pauseStartTime = null;
      }
      this.onStateChange({ isRecording: true, isPaused: false });
    }
  }

  stop() {
    return new Promise((resolve) => {
      if (!this.mediaRecorder || this.mediaRecorder.state === 'inactive') {
        resolve(null);
        return;
      }

      this.stopTimer();

      this.mediaRecorder.onstop = () => {
        const mimeType = this.mediaRecorder.mimeType || 'video/webm';
        const blob = new Blob(this.recordedChunks, { type: mimeType });
        const url = URL.createObjectURL(blob);
        const durationSeconds = Math.round((Date.now() - this.startTime - this.totalPausedDuration) / 1000);

        this.isRecording = false;
        this.isPaused = false;
        this.onStateChange({ isRecording: false, isPaused: false });

        resolve({
          blob,
          url,
          mimeType,
          duration: this.formatTime(durationSeconds),
          size: this.formatBytes(blob.size)
        });
      };

      this.mediaRecorder.stop();
    });
  }

  startTimer() {
    this.stopTimer();
    this.timerInterval = setInterval(() => {
      if (!this.isPaused) {
        const elapsed = Math.floor((Date.now() - this.startTime - this.totalPausedDuration) / 1000);
        this.onTick(this.formatTime(elapsed));
      }
    }, 1000);
    this.onTick('00:00');
  }

  stopTimer() {
    if (this.timerInterval) {
      clearInterval(this.timerInterval);
      this.timerInterval = null;
    }
  }

  formatTime(totalSeconds) {
    const mins = Math.floor(totalSeconds / 60);
    const secs = totalSeconds % 60;
    return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }

  formatBytes(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }
}

window.SessionRecorder = SessionRecorder;
