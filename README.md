# Flutterbox

Haunting ambient music generator that layers slowed-down samples from Internet Archive's public domain 78rpm vinyl collection with reverb, delay, and vinyl artifacts.

Inspired by Philip Jeck's work with manipulated vinyl.

## Features

- Fetches random 78rpm samples from archive.org
- Applies audio effects: slowdown, reverb, delay, wow/flutter, vinyl noise
- Web Audio API player with crossfading between samples
- Upload your own moody photograph as the play button
- Dark, minimal aesthetic

## Local Development

### With Python

```bash
# Install system dependencies (Ubuntu/Debian)
sudo apt-get install ffmpeg

# Install Python dependencies
pip install -r requirements.txt

# Run the app
python app.py
```

### With Docker

```bash
docker-compose up --build
```

Visit http://localhost:5000

## Deployment

### Heroku

```bash
heroku create your-flutterbox
heroku buildpacks:add --index 1 heroku/python
heroku buildpacks:add --index 2 https://github.com/jonathanong/heroku-buildpack-ffmpeg-latest.git
git push heroku main
```

### Railway / Render

Push to GitHub and connect your repository. The Dockerfile will be used automatically.

## How It Works

1. Backend fetches random items from archive.org's 78rpm collection
2. Downloads audio files and applies processing chain:
   - Slows down to 35-55% speed (creates haunting pitch shift)
   - Applies wow/flutter (tape wobble effect)
   - Adds reverb with multiple delay taps
   - Applies echo/delay
   - Generates vinyl crackle and hiss
   - Applies vintage frequency characteristics
3. Frontend receives processed audio via Web Audio API
4. Player crossfades between samples for continuous ambient texture

## Credits

- Audio samples from [Internet Archive](https://archive.org)
- Inspired by [Philip Jeck](https://en.wikipedia.org/wiki/Philip_Jeck)
