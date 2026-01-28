"""
Flutterbox - Haunting ambient music generator
Layers slowed-down 78rpm vinyl samples with reverb, delay, and vinyl artifacts
Inspired by Philip Jeck's manipulated vinyl aesthetic
"""

import os
import io
import random
import requests
from flask import Flask, render_template, jsonify, send_file, request
from flask_cors import CORS
import numpy as np
from scipy import signal
from scipy.io import wavfile
from pydub import AudioSegment
import tempfile
import hashlib
import time

app = Flask(__name__)
CORS(app)

# Cache for processed samples
SAMPLE_CACHE = {}
CACHE_DIR = tempfile.mkdtemp(prefix='flutterbox_')

# Archive.org 78rpm collection identifiers with known good audio
COLLECTION_SEARCHES = [
    'collection:78rpm AND mediatype:audio',
    'collection:georgeblood AND mediatype:audio',
    'collection:78rpm_bostonpubliclibrary AND mediatype:audio',
]


def fetch_random_archive_item():
    """Fetch a random audio item from archive.org's 78rpm collection"""
    search_query = random.choice(COLLECTION_SEARCHES)

    # Random page for variety
    page = random.randint(1, 50)

    search_url = 'https://archive.org/advancedsearch.php'
    params = {
        'q': search_query,
        'fl[]': ['identifier', 'title'],
        'rows': 20,
        'page': page,
        'output': 'json'
    }

    try:
        response = requests.get(search_url, params=params, timeout=15)
        response.raise_for_status()
        data = response.json()

        docs = data.get('response', {}).get('docs', [])
        if not docs:
            return None

        item = random.choice(docs)
        return item.get('identifier')
    except Exception as e:
        print(f"Error fetching archive item: {e}")
        return None


def get_audio_file_url(identifier):
    """Get a direct audio file URL from an archive.org item"""
    metadata_url = f'https://archive.org/metadata/{identifier}'

    try:
        response = requests.get(metadata_url, timeout=15)
        response.raise_for_status()
        data = response.json()

        files = data.get('files', [])

        # Prefer MP3 files for easier processing
        audio_files = [f for f in files if f.get('name', '').lower().endswith(('.mp3', '.ogg', '.wav'))]

        if not audio_files:
            return None

        # Pick a random audio file from the item
        audio_file = random.choice(audio_files)
        file_name = audio_file.get('name')

        return f'https://archive.org/download/{identifier}/{file_name}'
    except Exception as e:
        print(f"Error getting audio URL: {e}")
        return None


def download_audio(url):
    """Download audio file and return as AudioSegment"""
    try:
        response = requests.get(url, timeout=30, stream=True)
        response.raise_for_status()

        # Determine format from URL
        if url.lower().endswith('.mp3'):
            fmt = 'mp3'
        elif url.lower().endswith('.ogg'):
            fmt = 'ogg'
        elif url.lower().endswith('.wav'):
            fmt = 'wav'
        else:
            fmt = 'mp3'

        audio = AudioSegment.from_file(io.BytesIO(response.content), format=fmt)
        return audio
    except Exception as e:
        print(f"Error downloading audio: {e}")
        return None


def apply_slowdown(audio, factor=0.5):
    """Slow down audio by changing sample rate"""
    # Slowing down by reducing frame rate creates that haunting pitched-down effect
    slowed = audio._spawn(audio.raw_data, overrides={
        'frame_rate': int(audio.frame_rate * factor)
    })
    # Convert back to standard sample rate for playback
    return slowed.set_frame_rate(44100)


def apply_wow_flutter(samples, sample_rate, intensity=0.002, rate=0.5):
    """Apply wow and flutter effect (pitch wobble like old vinyl/tape)"""
    t = np.arange(len(samples)) / sample_rate

    # Combine slow wow with faster flutter
    wow = intensity * np.sin(2 * np.pi * rate * t)
    flutter = (intensity * 0.3) * np.sin(2 * np.pi * (rate * 6) * t)
    modulation = wow + flutter

    # Create time-varying delay
    output = np.zeros_like(samples, dtype=np.float64)
    for i in range(len(samples)):
        delay_samples = int(modulation[i] * sample_rate)
        source_idx = i - delay_samples
        if 0 <= source_idx < len(samples):
            output[i] = samples[source_idx]
        else:
            output[i] = samples[i]

    return output.astype(samples.dtype)


def apply_reverb(samples, sample_rate, decay=0.4, delay_ms=50):
    """Apply simple reverb effect using comb filter"""
    delay_samples = int(sample_rate * delay_ms / 1000)

    output = np.zeros(len(samples) + delay_samples * 8, dtype=np.float64)
    output[:len(samples)] = samples.astype(np.float64)

    # Multiple delay taps for richer reverb
    delays = [delay_samples, int(delay_samples * 1.3), int(delay_samples * 1.7), int(delay_samples * 2.1)]
    decays = [decay, decay * 0.7, decay * 0.5, decay * 0.3]

    for d, dec in zip(delays, decays):
        for i in range(d, len(output)):
            output[i] += output[i - d] * dec

    # Normalize
    max_val = np.max(np.abs(output))
    if max_val > 0:
        output = output / max_val * 0.9

    return output[:len(samples)].astype(samples.dtype)


def apply_delay(samples, sample_rate, delay_ms=300, feedback=0.4, mix=0.3):
    """Apply delay/echo effect"""
    delay_samples = int(sample_rate * delay_ms / 1000)

    output = np.zeros(len(samples) + delay_samples * 4, dtype=np.float64)
    output[:len(samples)] = samples.astype(np.float64)

    # Apply feedback delay
    for i in range(delay_samples, len(output)):
        output[i] += output[i - delay_samples] * feedback

    # Mix dry and wet
    result = (1 - mix) * samples.astype(np.float64) + mix * output[:len(samples)]

    # Normalize
    max_val = np.max(np.abs(result))
    if max_val > 0:
        result = result / max_val * 0.9

    return result.astype(samples.dtype)


def generate_vinyl_noise(length, sample_rate, intensity=0.02):
    """Generate vinyl crackle and hiss"""
    # Base hiss (pink noise approximation)
    white = np.random.randn(length)

    # Simple pink noise filter
    b = [0.049922035, -0.095993537, 0.050612699, -0.004408786]
    a = [1, -2.494956002, 2.017265875, -0.522189400]
    hiss = signal.lfilter(b, a, white) * intensity * 0.5

    # Crackles and pops
    crackle = np.zeros(length)
    num_crackles = int(length / sample_rate * 15)  # ~15 crackles per second

    for _ in range(num_crackles):
        pos = random.randint(0, length - 100)
        crackle_len = random.randint(10, 50)
        crackle[pos:pos + crackle_len] = np.random.randn(crackle_len) * intensity * random.uniform(0.5, 2)

    return (hiss + crackle).astype(np.float32)


def apply_vinyl_character(samples, sample_rate):
    """Apply vinyl-like frequency characteristics"""
    # Gentle high-frequency rolloff (like worn vinyl)
    nyq = sample_rate / 2
    cutoff = 8000 / nyq
    b, a = signal.butter(2, cutoff, btype='low')
    filtered = signal.lfilter(b, a, samples.astype(np.float64))

    # Slight bass boost
    bass_cutoff = 200 / nyq
    b_bass, a_bass = signal.butter(2, bass_cutoff, btype='low')
    bass = signal.lfilter(b_bass, a_bass, samples.astype(np.float64))

    result = filtered + bass * 0.2

    # Normalize
    max_val = np.max(np.abs(result))
    if max_val > 0:
        result = result / max_val * 0.85

    return result.astype(samples.dtype)


def process_sample(audio):
    """Apply full processing chain to create haunting ambient texture"""
    # Convert to mono for processing
    if audio.channels > 1:
        audio = audio.set_channels(1)

    # Shorter, uneven segment lengths (prime-ish numbers in seconds)
    # Creates hypnotic, unpredictable rhythm when layered
    segment_durations = [7000, 11000, 13000, 17000, 19000, 23000]  # 7-23 seconds
    duration_ms = len(audio)
    segment_length = min(random.choice(segment_durations), duration_ms)

    if duration_ms > segment_length:
        start = random.randint(0, duration_ms - segment_length)
        audio = audio[start:start + segment_length]

    # Slow down significantly (creates that haunting quality)
    # Varying slowdown also adds to the unevenness
    slowdown_factor = random.choice([0.33, 0.4, 0.45, 0.5, 0.55])
    audio = apply_slowdown(audio, slowdown_factor)

    # Convert to numpy for DSP
    samples = np.array(audio.get_array_of_samples())
    sample_rate = audio.frame_rate

    # Ensure float for processing
    if samples.dtype == np.int16:
        samples = samples.astype(np.float32) / 32768.0
    elif samples.dtype == np.int32:
        samples = samples.astype(np.float32) / 2147483648.0

    # Apply effects chain
    samples = apply_wow_flutter(samples, sample_rate, intensity=random.uniform(0.001, 0.003))
    samples = apply_vinyl_character(samples, sample_rate)
    samples = apply_reverb(samples, sample_rate, decay=random.uniform(0.3, 0.5))
    samples = apply_delay(samples, sample_rate, delay_ms=random.randint(200, 500), feedback=random.uniform(0.3, 0.5))

    # Add vinyl noise
    noise = generate_vinyl_noise(len(samples), sample_rate, intensity=random.uniform(0.01, 0.03))
    samples = samples + noise

    # Final normalization
    max_val = np.max(np.abs(samples))
    if max_val > 0:
        samples = samples / max_val * 0.8

    # Convert back to int16
    samples = (samples * 32767).astype(np.int16)

    # Create output audio segment
    output_audio = AudioSegment(
        samples.tobytes(),
        frame_rate=sample_rate,
        sample_width=2,
        channels=1
    )

    # Fade in/out for smooth crossfading (longer fades for dreamy quality)
    fade_duration = min(5000, len(output_audio) // 3)
    output_audio = output_audio.fade_in(fade_duration).fade_out(fade_duration)

    return output_audio


@app.route('/')
def index():
    return render_template('index.html')


@app.route('/api/sample')
def get_sample():
    """Generate and return a processed ambient sample"""
    # Try multiple times to get a working sample
    for attempt in range(5):
        identifier = fetch_random_archive_item()
        if not identifier:
            continue

        audio_url = get_audio_file_url(identifier)
        if not audio_url:
            continue

        audio = download_audio(audio_url)
        if not audio:
            continue

        if len(audio) < 10000:  # Skip very short samples
            continue

        try:
            processed = process_sample(audio)

            # Export to MP3
            buffer = io.BytesIO()
            processed.export(buffer, format='mp3', bitrate='192k')
            buffer.seek(0)

            return send_file(
                buffer,
                mimetype='audio/mpeg',
                as_attachment=False,
                download_name='sample.mp3'
            )
        except Exception as e:
            print(f"Processing error: {e}")
            continue

    return jsonify({'error': 'Could not generate sample'}), 500


@app.route('/api/health')
def health():
    return jsonify({'status': 'ok', 'message': 'Flutterbox is running'})


if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))
    debug = os.environ.get('FLASK_DEBUG', 'false').lower() == 'true'
    app.run(host='0.0.0.0', port=port, debug=debug)
