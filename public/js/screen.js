/**
 * AeroShare — Screen Capture, Audio Mixing & Presets Engine
 */

class ScreenManager {
  constructor() {
    this.screenStream = null;
    this.micStream = null;
    this.mixedStream = null;
    this.audioContext = null;
    this.audioDestination = null;
    this.micAnalyser = null;
    this.isMicMuted = false;
    this.selectedPreset = '1080p60';

    this.onStreamReady = () => {};
    this.onStreamEnded = () => {};
    this.onAudioLevel = () => {}; // For VU meter (0 to 1)
    this.onError = () => {};

    this.meterInterval = null;
  }

  getConstraints(presetKey) {
    const presets = {
      '1080p60': {
        width: { ideal: 1920, max: 2560 },
        height: { ideal: 1080, max: 1440 },
        frameRate: { ideal: 60, max: 60 }
      },
      '4k30': {
        width: { ideal: 3840 },
        height: { ideal: 2160 },
        frameRate: { ideal: 30, max: 30 }
      },
      '720p30': {
        width: { ideal: 1280 },
        height: { ideal: 720 },
        frameRate: { ideal: 30, max: 30 }
      }
    };

    const videoConstraints = presets[presetKey] || presets['1080p60'];
    return {
      video: {
        ...videoConstraints,
        cursor: 'always'
      },
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      }
    };
  }

  async startScreenCapture(presetKey = '1080p60', captureSystemAudio = true) {
    this.selectedPreset = presetKey;
    const constraints = this.getConstraints(presetKey);

    if (!captureSystemAudio) {
      constraints.audio = false;
    }

    try {
      this.screenStream = await navigator.mediaDevices.getDisplayMedia(constraints);

      // Listen for browser native stop-share button
      const videoTrack = this.screenStream.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.onended = () => {
          console.log('[Screen] Screen share ended via browser bar');
          this.stop();
          this.onStreamEnded();
        };
      }

      // Re-mix audio if mic is active
      await this.composeStream();
      this.onStreamReady(this.mixedStream || this.screenStream);
      return this.mixedStream || this.screenStream;
    } catch (err) {
      console.error('[Screen] getDisplayMedia error:', err);
      this.onError(err);
      throw err;
    }
  }

  async toggleMicrophone(enable) {
    if (enable) {
      try {
        this.micStream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true
          }
        });
        this.isMicMuted = false;
        await this.composeStream();
        this.startAudioMeter();
        return true;
      } catch (err) {
        console.error('[Screen] getUserMedia mic error:', err);
        this.onError(err);
        return false;
      }
    } else {
      if (this.micStream) {
        this.micStream.getTracks().forEach(t => t.stop());
        this.micStream = null;
      }
      this.isMicMuted = true;
      this.stopAudioMeter();
      await this.composeStream();
      return false;
    }
  }

  async composeStream() {
    const tracks = [];

    // 1. Add video track from screen
    if (this.screenStream) {
      const videoTrack = this.screenStream.getVideoTracks()[0];
      if (videoTrack) tracks.push(videoTrack);
    }

    // 2. Mix audio (System sound + Mic)
    const hasScreenAudio = this.screenStream && this.screenStream.getAudioTracks().length > 0;
    const hasMicAudio = this.micStream && this.micStream.getAudioTracks().length > 0 && !this.isMicMuted;

    if (hasScreenAudio || hasMicAudio) {
      if (!this.audioContext) {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        this.audioContext = new AudioCtx();
      }

      if (this.audioContext.state === 'suspended') {
        await this.audioContext.resume();
      }

      this.audioDestination = this.audioContext.createMediaStreamDestination();

      if (hasScreenAudio) {
        const screenAudioSource = this.audioContext.createMediaStreamSource(this.screenStream);
        screenAudioSource.connect(this.audioDestination);
      }

      if (hasMicAudio) {
        const micSource = this.audioContext.createMediaStreamSource(this.micStream);
        
        // Add analyser for VU meter
        this.micAnalyser = this.audioContext.createAnalyser();
        this.micAnalyser.fftSize = 64;
        micSource.connect(this.micAnalyser);
        micSource.connect(this.audioDestination);
      }

      const mixedAudioTrack = this.audioDestination.stream.getAudioTracks()[0];
      if (mixedAudioTrack) {
        tracks.push(mixedAudioTrack);
      }
    }

    this.mixedStream = new MediaStream(tracks);
    return this.mixedStream;
  }

  startAudioMeter() {
    this.stopAudioMeter();
    if (!this.micAnalyser) return;

    const dataArray = new Uint8Array(this.micAnalyser.frequencyBinCount);
    this.meterInterval = setInterval(() => {
      if (!this.micAnalyser || this.isMicMuted) {
        this.onAudioLevel(0);
        return;
      }
      this.micAnalyser.getByteFrequencyData(dataArray);
      let sum = 0;
      for (let i = 0; i < dataArray.length; i++) {
        sum += dataArray[i];
      }
      const avg = sum / dataArray.length;
      const level = Math.min(1, avg / 128); // 0 to 1 normalized
      this.onAudioLevel(level);
    }, 100);
  }

  stopAudioMeter() {
    if (this.meterInterval) {
      clearInterval(this.meterInterval);
      this.meterInterval = null;
    }
    this.onAudioLevel(0);
  }

  stop() {
    this.stopAudioMeter();
    if (this.screenStream) {
      this.screenStream.getTracks().forEach(t => t.stop());
      this.screenStream = null;
    }
    if (this.micStream) {
      this.micStream.getTracks().forEach(t => t.stop());
      this.micStream = null;
    }
    if (this.audioContext && this.audioContext.state !== 'closed') {
      this.audioContext.close().catch(() => {});
      this.audioContext = null;
    }
    this.mixedStream = null;
  }
}

window.ScreenManager = ScreenManager;
