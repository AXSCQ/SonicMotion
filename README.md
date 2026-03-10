# 🎵 SonicMotion.js v3.1.0

**Ultra-Lightweight Audio-Reactive UI Library (0 dependencies, ~10KB)**

Convierte tu interfaz web en un visualizador interactivo sincronizado con la música. Usa stems de audio (pistas separadas) y atributos HTML para controlar animaciones en tiempo real.

---

## Instalación

```bash
npm install sonicmotion
```

```javascript
import SonicMotion from 'sonicmotion';
```

---

## Uso rápido

### 1. Inicializa con Master + Stems

```javascript
import SonicMotion from 'sonicmotion';

const sonic = SonicMotion.create({
    master: '/music/master.mp3',   // Audio que el usuario escucha
    stems: {
        kick:   '/music/kick.mp3',    // Bombo (analizado en silencio)
        bass:   '/music/bass.mp3',    // Bajo
        vocals: '/music/vocals.mp3'   // Voces
    }
});

sonic.initDOM(); // Escanea el DOM buscando [data-sonic]
```

### 2. Usa atributos HTML para las animaciones

```html
<!-- Escala con el kick, solo cuando supera 80% de energía -->
<div data-sonic="scale"
     data-sonic-track="kick"
     data-sonic-threshold="0.8">
  Explota con el bombo
</div>

<!-- Brillo con los bajos del stem "bass" (banda de frecuencia baja) -->
<h1 data-sonic="glow"
    data-sonic-track="bass"
    data-sonic-band="bass"
    data-sonic-threshold="0.3">
  Brilla con los graves
</h1>

<!-- Vibración con los agudos de las voces -->
<div data-sonic="shake"
     data-sonic-track="vocals"
     data-sonic-band="treble">
  Tiembla con los sibilantes
</div>
```

### 3. Reproducir (requiere gesto del usuario)

```javascript
document.getElementById('play-btn').addEventListener('click', () => {
    sonic.play();
});
```

---

## Atributos HTML declarativos

| Atributo | Valores | Descripción |
|---|---|---|
| `data-sonic` | `scale`, `pulse`, `glow`, `shake`, `rotate`, `wave`, `float`, `color` | Efecto a aplicar |
| `data-sonic-track` | nombre del stem | Stem del que lee la energía |
| `data-sonic-band` | `bass`, `mid`, `treble` | **Nuevo v3.1** — Banda de frecuencia específica |
| `data-sonic-threshold` | `0.0` – `1.0` | Umbral mínimo para activar el efecto |
| `data-sonic-intensity` | `0.0` – `2.0` | Multiplica la magnitud del efecto |

### Bandas de frecuencia (`data-sonic-band`)

| Banda | Rango aprox. | Captura |
|---|---|---|
| `bass` | 0 – 2.2 kHz | Kick, bombo, sub-bass |
| `mid` | 2.2 – 11 kHz | Snare, guitarra, voz principal |
| `treble` | 11 – 22 kHz | Hi-hats, platillos, brillos |
| *(sin atributo)* | global | Energía total del stem |

---

## API JavaScript

### `SonicMotion.create(options)`

```javascript
const sonic = SonicMotion.create({
    master: '/audio/master.mp3',
    stems: {
        kick: '/audio/kick.mp3',      // string URL
        bass: fileObject,              // o File / Blob
    },
    noiseFloor: 0.08  // Umbral de ruido global (0.0–1.0). Default: 0.08
});
```

### `sonic.addStem(name, source, options?)`

```javascript
// Agregar un stem con noise gate personalizado
sonic.addStem('hihat', '/audio/hihat.mp3', {
    noiseFloor: 0.12   // más alto = solo golpes fuertes
});
```

### `sonic.bind(selector, config)`

```javascript
sonic.bind('#my-element', {
    effect: 'scale',
    stem: 'kick',
    band: 'bass',       // 'bass' | 'mid' | 'treble' | null
    threshold: 0.35,
    intensity: 1.2,
});
```

### `sonic.onFrame(callback)`

```javascript
sonic.onFrame((data) => {
    // data.kick.value   → energía global del stem (0–1)
    // data.kick.bands.bass    → energía en graves (0–1)
    // data.kick.bands.mid     → energía en medios (0–1)
    // data.kick.bands.treble  → energía en agudos (0–1)
    console.log(data.kick.bands.bass);
});
```

### Otros métodos

```javascript
sonic.play()      // Reproduce
sonic.pause()     // Pausa
sonic.seek(time)  // Salta al segundo `time`
sonic.initDOM()   // Re-escanea el DOM
sonic.destroy()   // Limpia todos los recursos
```

---

## Efectos incorporados

| Efecto | Descripción |
|---|---|
| `scale` | El elemento crece con la energía |
| `pulse` | Escala + opacidad reactiva |
| `glow` | Halo (box-shadow) pulsante |
| `shake` | Vibración rápida |
| `rotate` | Rotación suave continua |
| `wave` | Movimiento sinusoidal vertical |
| `float` | Flotación orgánica |
| `color` | Cambio de tonalidad (hue) |

### Registrar efecto personalizado

```javascript
SonicMotion.registerEffect('my-effect', (element, value, config) => {
    // value: 0.0 – 1.0
    element.style.transform = `scale(${1 + value * 0.5})`;
    element.style.filter = `brightness(${1 + value})`;
});
```

---

## Cambios v3.1.0

- **Análisis por banda de frecuencia** — bass / mid / treble independientes con noise gate, AGC y curva de potencia propios
- **`data-sonic-band`** — nuevo atributo HTML para dirigir efectos a una banda específica
- **`onFrame` mejorado** — incluye `bands: { bass, mid, treble }` por stem
- **Ruido reducido** — noise gate configurable por stem (`noiseFloor`), AGC desacoplado del silencio, `smoothingTimeConstant` 0.3

---

## Licencia

MIT © 2025 SonicMotion
