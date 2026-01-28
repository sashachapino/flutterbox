/**
 * Flutterbox - Photo breathes with the music
 */

class Flutterbox {
    constructor() {
        this.audioContext = null;
        this.isPlaying = false;
        this.layers = []; // Multiple concurrent audio layers
        this.analyser = null;
        this.masterGain = null;

        // Layering config - uneven timing for hypnotic shifts
        this.maxLayers = 4;
        this.layerIntervals = [3000, 5000, 7000, 11000, 13000]; // Prime-ish numbers for unevenness

        this.container = document.getElementById('photoContainer');
        this.photo = document.getElementById('coverPhoto');
        this.canvas = document.getElementById('rippleCanvas');
        this.ctx = this.canvas.getContext('2d');
        this.photoInput = document.getElementById('photoInput');

        this.container.classList.add('dormant');
        this.setupCanvas();
        this.setupEvents();
        this.createDefaultPhoto();
    }

    setupCanvas() {
        const resize = () => {
            this.canvas.width = window.innerWidth;
            this.canvas.height = window.innerHeight;
        };
        resize();
        window.addEventListener('resize', resize);
    }

    setupEvents() {
        this.container.addEventListener('click', (e) => {
            // Secret: double-click to upload photo
            if (e.detail === 2) {
                this.photoInput.click();
            } else {
                this.toggle();
            }
        });

        this.photoInput.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (file) {
                const reader = new FileReader();
                reader.onload = (ev) => {
                    this.photo.src = ev.target.result;
                };
                reader.readAsDataURL(file);
            }
        });
    }

    createDefaultPhoto() {
        // Create an atmospheric default
        const canvas = document.createElement('canvas');
        canvas.width = 1920;
        canvas.height = 1080;
        const ctx = canvas.getContext('2d');

        // Dark gradient
        const gradient = ctx.createRadialGradient(960, 540, 0, 960, 540, 900);
        gradient.addColorStop(0, '#1a1a1a');
        gradient.addColorStop(0.5, '#0d0d0d');
        gradient.addColorStop(1, '#000000');
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, 1920, 1080);

        // Add subtle noise
        const imageData = ctx.getImageData(0, 0, 1920, 1080);
        for (let i = 0; i < imageData.data.length; i += 4) {
            const noise = (Math.random() - 0.5) * 15;
            imageData.data[i] += noise;
            imageData.data[i + 1] += noise;
            imageData.data[i + 2] += noise;
        }
        ctx.putImageData(imageData, 0, 0);

        this.photo.src = canvas.toDataURL('image/jpeg', 0.9);
    }

    async initAudio() {
        if (!this.audioContext) {
            this.audioContext = new (window.AudioContext || window.webkitAudioContext)();

            this.masterGain = this.audioContext.createGain();
            this.masterGain.gain.value = 0.8;
            this.masterGain.connect(this.audioContext.destination);

            this.analyser = this.audioContext.createAnalyser();
            this.analyser.fftSize = 512;
            this.analyser.smoothingTimeConstant = 0.85;
            this.masterGain.connect(this.analyser);
        }

        if (this.audioContext.state === 'suspended') {
            await this.audioContext.resume();
        }
    }

    async toggle() {
        if (this.isPlaying) {
            this.stop();
        } else {
            await this.start();
        }
    }

    async start() {
        await this.initAudio();
        this.isPlaying = true;

        // Awaken - slow fade in
        this.container.classList.remove('dormant');
        this.container.classList.add('awakening');

        // Start loading first layer
        this.scheduleNextLayer();

        // Start visual reactivity
        this.animate();

        // Transition to full playing state after initial fade
        setTimeout(() => {
            if (this.isPlaying) {
                this.container.classList.remove('awakening');
                this.container.classList.add('playing');
            }
        }, 8000);
    }

    stop() {
        this.isPlaying = false;

        // Clear scheduled layers
        this.layers.forEach(layer => {
            if (layer.timeout) clearTimeout(layer.timeout);
            if (layer.gain) {
                layer.gain.gain.linearRampToValueAtTime(0, this.audioContext.currentTime + 3);
            }
        });

        setTimeout(() => {
            this.layers.forEach(layer => {
                try { layer.source?.stop(); } catch(e) {}
            });
            this.layers = [];
        }, 3000);

        this.container.classList.remove('playing', 'awakening');
        this.container.classList.add('dormant');
    }

    scheduleNextLayer() {
        if (!this.isPlaying) return;

        // Random interval from our uneven set
        const interval = this.layerIntervals[Math.floor(Math.random() * this.layerIntervals.length)];

        setTimeout(() => {
            if (this.isPlaying) {
                this.loadLayer();
                this.scheduleNextLayer();
            }
        }, interval);

        // Also load immediately if we have no layers
        if (this.layers.length === 0) {
            this.loadLayer();
        }
    }

    async loadLayer() {
        if (!this.isPlaying) return;

        // Remove finished layers
        this.layers = this.layers.filter(l => !l.ended);

        // Don't exceed max layers
        if (this.layers.length >= this.maxLayers) return;

        try {
            const response = await fetch('/api/sample');
            if (!response.ok) return;

            const arrayBuffer = await response.arrayBuffer();
            const audioBuffer = await this.audioContext.decodeAudioData(arrayBuffer);

            if (!this.isPlaying) return;

            const source = this.audioContext.createBufferSource();
            const gain = this.audioContext.createGain();

            source.buffer = audioBuffer;
            source.connect(gain);
            gain.connect(this.masterGain);

            // Random volume for each layer (creates depth)
            const targetVolume = 0.3 + Math.random() * 0.5;

            // Slow fade in
            gain.gain.setValueAtTime(0, this.audioContext.currentTime);
            gain.gain.linearRampToValueAtTime(targetVolume, this.audioContext.currentTime + 6);

            const layer = {
                source,
                gain,
                ended: false,
                startTime: this.audioContext.currentTime
            };

            source.onended = () => {
                layer.ended = true;
            };

            // Schedule fade out before end
            const duration = audioBuffer.duration;
            const fadeOutStart = Math.max(0, duration - 8);

            setTimeout(() => {
                if (!layer.ended && this.isPlaying) {
                    gain.gain.linearRampToValueAtTime(0, this.audioContext.currentTime + 6);
                }
            }, fadeOutStart * 1000);

            source.start();
            this.layers.push(layer);

        } catch (e) {
            console.error('Layer load error:', e);
        }
    }

    animate() {
        if (!this.isPlaying) {
            // Clear canvas when stopped
            this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
            return;
        }

        requestAnimationFrame(() => this.animate());

        if (!this.analyser) return;

        // Get audio data
        const dataArray = new Uint8Array(this.analyser.frequencyBinCount);
        this.analyser.getByteFrequencyData(dataArray);

        // Calculate average levels for different frequency bands
        const bass = this.getAverage(dataArray, 0, 10) / 255;
        const mid = this.getAverage(dataArray, 10, 100) / 255;
        const high = this.getAverage(dataArray, 100, 200) / 255;
        const overall = this.getAverage(dataArray, 0, dataArray.length) / 255;

        // Photo reactivity
        this.updatePhotoEffects(bass, mid, high, overall);

        // Canvas ripple/flutter effect
        this.drawRipples(bass, mid, overall);
    }

    getAverage(array, start, end) {
        let sum = 0;
        for (let i = start; i < end && i < array.length; i++) {
            sum += array[i];
        }
        return sum / (end - start);
    }

    updatePhotoEffects(bass, mid, high, overall) {
        // Subtle brightness/contrast shifts based on audio
        const brightness = 0.9 + overall * 0.2;
        const contrast = 1.0 + bass * 0.15;
        const blur = Math.max(0, (1 - overall) * 0.5);

        // Subtle scale breathing
        const scale = 1.0 + bass * 0.02;

        this.photo.style.filter = `
            grayscale(100%)
            contrast(${contrast})
            brightness(${brightness})
            blur(${blur}px)
        `;
        this.photo.style.transform = `translate(-50%, -50%) scale(${scale})`;

        // Opacity flutters with high frequencies
        const opacity = 0.85 + high * 0.15;
        this.photo.style.opacity = opacity;
    }

    drawRipples(bass, mid, overall) {
        const w = this.canvas.width;
        const h = this.canvas.height;

        // Fade previous frame
        this.ctx.fillStyle = 'rgba(0, 0, 0, 0.1)';
        this.ctx.fillRect(0, 0, w, h);

        // Draw subtle noise/grain that reacts to audio
        if (overall > 0.1) {
            const intensity = overall * 50;
            const imageData = this.ctx.getImageData(0, 0, w, h);

            for (let i = 0; i < imageData.data.length; i += 40) {
                if (Math.random() < overall * 0.3) {
                    const noise = (Math.random() - 0.5) * intensity;
                    imageData.data[i] = Math.max(0, Math.min(255, noise + 128));
                    imageData.data[i + 1] = Math.max(0, Math.min(255, noise + 128));
                    imageData.data[i + 2] = Math.max(0, Math.min(255, noise + 128));
                    imageData.data[i + 3] = Math.abs(noise);
                }
            }

            this.ctx.putImageData(imageData, 0, 0);
        }

        // Horizontal scan lines that flutter with bass
        if (bass > 0.2) {
            this.ctx.strokeStyle = `rgba(255, 255, 255, ${bass * 0.1})`;
            this.ctx.lineWidth = 1;

            const numLines = Math.floor(bass * 5);
            for (let i = 0; i < numLines; i++) {
                const y = Math.random() * h;
                this.ctx.beginPath();
                this.ctx.moveTo(0, y);
                this.ctx.lineTo(w, y);
                this.ctx.stroke();
            }
        }
    }
}

// Start when ready
document.addEventListener('DOMContentLoaded', () => {
    window.flutterbox = new Flutterbox();
});
