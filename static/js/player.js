/**
 * Flutterbox Audio Player
 * Web Audio API-based ambient music player with crossfading
 */

class FlutterboxPlayer {
    constructor() {
        this.audioContext = null;
        this.isPlaying = false;
        this.currentSources = [];
        this.gainNodes = [];
        this.analyser = null;
        this.loadingNext = false;

        // Configuration
        this.crossfadeDuration = 8; // seconds
        this.overlapTime = 12; // seconds before end to start next
        this.maxConcurrentLayers = 2;

        // UI Elements
        this.photoFrame = document.getElementById('photoFrame');
        this.coverPhoto = document.getElementById('coverPhoto');
        this.photoInput = document.getElementById('photoInput');
        this.uploadBtn = document.getElementById('uploadBtn');
        this.playIndicator = document.getElementById('playIndicator');
        this.status = document.getElementById('status');
        this.statusText = this.status.querySelector('.status-text');
        this.visualizer = document.getElementById('visualizer');
        this.canvas = document.getElementById('waveform');
        this.canvasCtx = this.canvas.getContext('2d');

        this.setupEventListeners();
        this.setupCanvas();
        this.createDefaultImage();
    }

    setupEventListeners() {
        this.photoFrame.addEventListener('click', () => this.togglePlayback());
        this.uploadBtn.addEventListener('click', () => this.photoInput.click());
        this.photoInput.addEventListener('change', (e) => this.handlePhotoUpload(e));

        // Handle visibility change to save resources
        document.addEventListener('visibilitychange', () => {
            if (document.hidden && this.isPlaying) {
                // Keep playing but stop visualization
                this.stopVisualization();
            } else if (!document.hidden && this.isPlaying) {
                this.startVisualization();
            }
        });
    }

    setupCanvas() {
        const resize = () => {
            const rect = this.canvas.parentElement.getBoundingClientRect();
            this.canvas.width = rect.width * window.devicePixelRatio;
            this.canvas.height = rect.height * window.devicePixelRatio;
            this.canvasCtx.scale(window.devicePixelRatio, window.devicePixelRatio);
        };
        resize();
        window.addEventListener('resize', resize);
    }

    createDefaultImage() {
        // Create a moody default image if none exists
        const canvas = document.createElement('canvas');
        canvas.width = 800;
        canvas.height = 600;
        const ctx = canvas.getContext('2d');

        // Create atmospheric gradient
        const gradient = ctx.createRadialGradient(400, 300, 0, 400, 300, 500);
        gradient.addColorStop(0, '#2a2a2a');
        gradient.addColorStop(0.5, '#1a1a1a');
        gradient.addColorStop(1, '#0a0a0a');

        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, 800, 600);

        // Add some noise texture
        const imageData = ctx.getImageData(0, 0, 800, 600);
        const data = imageData.data;
        for (let i = 0; i < data.length; i += 4) {
            const noise = (Math.random() - 0.5) * 20;
            data[i] += noise;
            data[i + 1] += noise;
            data[i + 2] += noise;
        }
        ctx.putImageData(imageData, 0, 0);

        // Add subtle vignette text
        ctx.fillStyle = 'rgba(255, 255, 255, 0.03)';
        ctx.font = '14px Cormorant Garamond, serif';
        ctx.textAlign = 'center';
        ctx.fillText('upload your photograph', 400, 580);

        this.coverPhoto.src = canvas.toDataURL('image/jpeg', 0.9);
    }

    handlePhotoUpload(event) {
        const file = event.target.files[0];
        if (file) {
            const reader = new FileReader();
            reader.onload = (e) => {
                this.coverPhoto.src = e.target.result;
                this.updateStatus('photograph loaded');
                setTimeout(() => this.updateStatus('click the photograph to begin'), 2000);
            };
            reader.readAsDataURL(file);
        }
    }

    async initAudioContext() {
        if (!this.audioContext) {
            this.audioContext = new (window.AudioContext || window.webkitAudioContext)();

            // Create master gain
            this.masterGain = this.audioContext.createGain();
            this.masterGain.connect(this.audioContext.destination);

            // Create analyser for visualization
            this.analyser = this.audioContext.createAnalyser();
            this.analyser.fftSize = 256;
            this.analyser.smoothingTimeConstant = 0.8;
            this.masterGain.connect(this.analyser);
        }

        if (this.audioContext.state === 'suspended') {
            await this.audioContext.resume();
        }
    }

    async togglePlayback() {
        if (this.isPlaying) {
            this.stop();
        } else {
            await this.start();
        }
    }

    async start() {
        try {
            await this.initAudioContext();
            this.isPlaying = true;

            this.photoFrame.classList.add('playing');
            this.visualizer.classList.add('active');
            this.status.classList.add('active');
            this.playIndicator.textContent = '❚❚';

            this.updateStatus('summoning sounds from the archive...');

            // Start first layer
            await this.loadAndPlaySample();

            // Start visualization
            this.startVisualization();

        } catch (error) {
            console.error('Error starting playback:', error);
            this.updateStatus('error connecting to the archive');
            this.stop();
        }
    }

    stop() {
        this.isPlaying = false;

        // Fade out all current sources
        const fadeOutTime = 2;
        const now = this.audioContext?.currentTime || 0;

        this.gainNodes.forEach(gain => {
            gain.gain.linearRampToValueAtTime(0, now + fadeOutTime);
        });

        // Stop sources after fade
        setTimeout(() => {
            this.currentSources.forEach(source => {
                try {
                    source.stop();
                } catch (e) {}
            });
            this.currentSources = [];
            this.gainNodes = [];
        }, fadeOutTime * 1000);

        this.photoFrame.classList.remove('playing');
        this.visualizer.classList.remove('active');
        this.status.classList.remove('active');
        this.playIndicator.textContent = '▶';

        this.updateStatus('click the photograph to begin');
        this.stopVisualization();
    }

    async loadAndPlaySample() {
        if (!this.isPlaying || this.loadingNext) return;

        this.loadingNext = true;

        try {
            this.updateStatus('fetching vinyl from the archive...');

            const response = await fetch('/api/sample');
            if (!response.ok) throw new Error('Failed to fetch sample');

            const arrayBuffer = await response.arrayBuffer();
            const audioBuffer = await this.audioContext.decodeAudioData(arrayBuffer);

            this.updateStatus('playing');

            // Create source and gain
            const source = this.audioContext.createBufferSource();
            const gain = this.audioContext.createGain();

            source.buffer = audioBuffer;
            source.connect(gain);
            gain.connect(this.masterGain);

            // Fade in
            gain.gain.setValueAtTime(0, this.audioContext.currentTime);
            gain.gain.linearRampToValueAtTime(0.7, this.audioContext.currentTime + this.crossfadeDuration);

            // Track sources
            this.currentSources.push(source);
            this.gainNodes.push(gain);

            // Clean up old layers if we have too many
            while (this.currentSources.length > this.maxConcurrentLayers) {
                const oldSource = this.currentSources.shift();
                const oldGain = this.gainNodes.shift();
                oldGain.gain.linearRampToValueAtTime(0, this.audioContext.currentTime + this.crossfadeDuration);
                setTimeout(() => {
                    try { oldSource.stop(); } catch(e) {}
                }, this.crossfadeDuration * 1000);
            }

            // Start playback
            source.start();

            // Schedule next sample before this one ends
            const duration = audioBuffer.duration;
            const nextLoadTime = Math.max(0, (duration - this.overlapTime) * 1000);

            source.onended = () => {
                // Remove from tracking
                const idx = this.currentSources.indexOf(source);
                if (idx > -1) {
                    this.currentSources.splice(idx, 1);
                    this.gainNodes.splice(idx, 1);
                }
            };

            // Load next sample with overlap
            setTimeout(() => {
                this.loadingNext = false;
                if (this.isPlaying) {
                    this.loadAndPlaySample();
                }
            }, nextLoadTime);

        } catch (error) {
            console.error('Error loading sample:', error);
            this.updateStatus('searching for more vinyl...');
            this.loadingNext = false;

            // Retry after a delay
            if (this.isPlaying) {
                setTimeout(() => this.loadAndPlaySample(), 3000);
            }
        }
    }

    updateStatus(text) {
        this.statusText.textContent = text;
        if (text.includes('fetching') || text.includes('searching') || text.includes('summoning')) {
            this.status.classList.add('loading');
        } else {
            this.status.classList.remove('loading');
        }
    }

    startVisualization() {
        if (!this.analyser) return;

        const bufferLength = this.analyser.frequencyBinCount;
        const dataArray = new Uint8Array(bufferLength);

        const draw = () => {
            if (!this.isPlaying) return;

            this.animationFrame = requestAnimationFrame(draw);

            this.analyser.getByteFrequencyData(dataArray);

            const width = this.canvas.width / window.devicePixelRatio;
            const height = this.canvas.height / window.devicePixelRatio;

            // Clear with fade effect
            this.canvasCtx.fillStyle = 'rgba(10, 10, 10, 0.3)';
            this.canvasCtx.fillRect(0, 0, width, height);

            // Draw subtle waveform
            this.canvasCtx.strokeStyle = 'rgba(196, 167, 125, 0.3)';
            this.canvasCtx.lineWidth = 1;
            this.canvasCtx.beginPath();

            const sliceWidth = width / bufferLength;
            let x = 0;

            for (let i = 0; i < bufferLength; i++) {
                const v = dataArray[i] / 255.0;
                const y = height / 2 + (v - 0.5) * height * 0.8;

                if (i === 0) {
                    this.canvasCtx.moveTo(x, y);
                } else {
                    this.canvasCtx.lineTo(x, y);
                }

                x += sliceWidth;
            }

            this.canvasCtx.stroke();

            // Draw center line
            this.canvasCtx.strokeStyle = 'rgba(68, 68, 68, 0.3)';
            this.canvasCtx.beginPath();
            this.canvasCtx.moveTo(0, height / 2);
            this.canvasCtx.lineTo(width, height / 2);
            this.canvasCtx.stroke();
        };

        draw();
    }

    stopVisualization() {
        if (this.animationFrame) {
            cancelAnimationFrame(this.animationFrame);
            this.animationFrame = null;
        }

        // Clear canvas
        const width = this.canvas.width / window.devicePixelRatio;
        const height = this.canvas.height / window.devicePixelRatio;
        this.canvasCtx.fillStyle = 'rgba(10, 10, 10, 1)';
        this.canvasCtx.fillRect(0, 0, width, height);
    }
}

// Initialize player when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    window.flutterbox = new FlutterboxPlayer();
});
