# 🎵 SonicMotion.js 
**The Audio-Reactive Web Motion Library for Frontend Developers**

![npm bundle size](https://img.shields.io/bundlephobia/minzip/sonicmotion)
![npm version](https://img.shields.io/npm/v/sonicmotion)
![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)

Convierte tu interfaz web en una experiencia inmersiva. **SonicMotion** es una *Frontend Library* que utiliza la **Web Audio API** para analizar frecuencias de sonido en tiempo real y sincronizar animaciones del DOM al ritmo exacto de la música.

A diferencia de proyectos académicos de audio espacial, SonicMotion está diseñada 100% para interactuar de forma sencilla con la UI de tu sitio web usando *Stems* de audio (pistas separadas como bajo, batería, voces) y atributos HTML para controlar animaciones en tiempo real sin dependencias.

## ✨ Features

- 🚀 **Audio-Reactive DOM Animation**: Haz que tus botones, fondos y textos reaccionen a la frecuencia del sonido.
- 🎛️ **Stem-Driven Motion**: Anima elementos individuales basados en la batería, el bajo o las voces en tiempo real.
- ⚡ **Zero-Dependencies**: Ultra ligera (~10KB).
- 🎨 **Declarative HTML API**: Añade un atributo `data-sonic` a tu interfaz y deja que la magia ocurra sin escribir JavaScript animado complejo.
- 🎧 **Frequency Band Analysis**: Aísla frecuencias graves, medias y agudas (bass/mid/treble) de forma nativa.

## 🌟 Live Demos
* [Experiencia Billie Jean - Tributo a Michael Jackson] (Poner enlace)
* [Visualizador de Frecuencias Minimalista] (Poner enlace)

---

## 💻 Quick Start & Instalación

```bash
npm install sonicmotion
```

### 1. Inicializa con Master + Stems

```javascript
import SonicMotion from 'sonicmotion';

const sonic = SonicMotion.create({
    master: '/music/master.mp3',   // Audio principal que el usuario escucha
    stems: {
        kick:   '/music/kick.mp3',    // Bombo (analizado en silencio)
        bass:   '/music/bass.mp3',    // Bajo
        vocals: '/music/vocals.mp3'   // Voces
    }
});

sonic.initDOM(); // Escanea el DOM buscando los atributos [data-sonic]
```

### 2. Usa atributos HTML para las animaciones (DOM Audio Animation)

```html
<!-- Este elemento crecerá con la energía del bombo (kick) -->
<div data-sonic="scale" data-sonic-track="kick">
  Explota con el bombo
</div>

<!-- Brillo con los graves (bass band) del bajo -->
<h1 data-sonic="glow" data-sonic-track="bass" data-sonic-band="bass">
  Brilla con frecuencias graves
</h1>
```

### 3. Reproducir (requiere interacción del usuario)

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
