# 🎵 SonicMotion.js v2

**Stem-based audio-reactive UI animation library** — Make your website move with music.

Users provide pre-separated audio stems (kick, bass, vocals, etc.) plus the original track. The library plays the master track audibly while analyzing each stem silently to drive CSS animations on DOM elements.

## Quick Start

```html
<script type="module">
  import SonicMotion from './src/sonicmotion.js';

  const sm = SonicMotion.create({
    master: '/audio/master.mp3',
    stems: {
      kick:   '/audio/kick.mp3',
      bass:   '/audio/bass.mp3',
      vocals: '/audio/vocals.mp3'
    }
  });

  sm.bind('.hero',  { effect: 'pulse', stem: 'kick',   intensity: 0.6 });
  sm.bind('.title', { effect: 'glow',  stem: 'vocals', intensity: 0.5 });
  sm.play();
</script>
```

## Folder Structure

Organize your audio files:

```
my-song/
├── master.mp3     ← Plays audibly (full track)
├── kick.mp3       ← Silent analysis only
├── snare.mp3
├── bass.mp3
├── guitar.mp3
├── vocals.mp3
└── ...            ← Any other stems
```

> The file named `master` (or `original`/`full`) is played. All others are analyzed silently.

## API

### `SonicMotion.create(config?)`

```js
const sm = SonicMotion.create({
  master: '/audio/master.mp3',
  stems: { kick: '/audio/kick.mp3', vocals: '/audio/vocals.mp3' }
});
```

### `.loadFolder(files)`

Auto-detect master + stems from a FileList (folder upload / drag & drop):

```js
sm.loadFolder(fileInputElement.files);
```

### `.bind(selector, config)`

Bind DOM elements to a stem-driven effect:

```js
sm.bind('.card', { effect: 'scale', stem: 'kick', intensity: 0.7 });
```

### `.onBeat(stemName, callback)`

```js
sm.onBeat('kick', ({ intensity, bpm }) => {
  console.log(`Kick beat! ${bpm} BPM`);
});
```

### `.onFrame(callback)`

```js
sm.onFrame((data) => {
  console.log(data.kick.value);   // 0-1 energy
  console.log(data.vocals.value);
});
```

### Control: `.play()` / `.pause()` / `.seek(seconds)` / `.destroy()`

## Effects

| Effect | Description |
|--------|-------------|
| `scale` | Size pulsing |
| `pulse` | Scale + opacity |
| `rotate` | Rotation |
| `shake` | Vibration |
| `glow` | Box shadow glow |
| `wave` | Sinusoidal vertical |
| `color` | Hue rotation |
| `blur` | Reactive blur |
| `float` | Organic floating |

## Custom Effects

```js
SonicMotion.registerEffect('myEffect', (element, value, config) => {
  element.style.letterSpacing = (value * 20) + 'px';
});

sm.bind('.title', { effect: 'myEffect', stem: 'vocals' });
```

## How It Works

1. **Master audio** connects to `AudioContext.destination` → you hear it
2. **Each stem** connects to its own `AnalyserNode` → a zero-gain node → silent
3. **Energy analyzer** reads RMS + peak per stem each frame → 0-1 value
4. **Effects controller** applies CSS transforms based on each stem's energy

## License

MIT
