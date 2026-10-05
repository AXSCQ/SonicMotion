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

| Banda | Rango | Captura |
|---|---|---|
| `bass` | 20 – 250 Hz | Kick, bombo, bajo, sub-bass |
| `mid` | 250 Hz – 4 kHz | Snare, guitarra, voz principal |
| `treble` | 4 – 16 kHz | Hi-hats, platillos, brillos |
| *(sin atributo)* | global | Energía total del stem |

Sub-campos: `bass.punch` (salto brusco de la banda) y `bass.onset` (ataque).

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
    compensateLatency: true  // entrega los datos cuando su sonido SE ESCUCHA (default)
});
```

### `sonic.addStem(name, source, options?)`

```javascript
sonic.addStem('bass', '/audio/bass.mp3', {
    noiseFloor: 0.05,       // `value` por debajo de esto se reporta como 0 (0–1)
    gateDb: -60,            // RMS por debajo de esto (dBFS) es silencio
    onsetThreshold: 3,      // sensibilidad de ataques: más alto = menos y más seguros (default 2)
    minOnsetGapMs: 120,     // separación mínima entre ataques (default 80)
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
    // data.kick.value          → sonoridad del stem (0–1), relativa a su propio pico
    // data.kick.level          → nivel RMS real en dBFS
    // data.kick.onset          → 0–1 SOLO en el cuadro del ataque (nota, golpe, sílaba)
    // data.kick.bands.bass     → { value, punch, onset } de 20–250 Hz
    // data.kick.bands.mid      → { value, punch, onset } de 250 Hz–4 kHz
    // data.kick.bands.treble   → { value, punch, onset } de 4–16 kHz
    // data.kick.trend          → { fast, slow, rising, drop }
    // data._time               → segundo de la canción de ESTE cuadro (ya compensado)
    // data._latency            → latencia de salida compensada (s)
    // data._syncOffset         → cuánto más tarde suenan los stems que el master (s)
    if (data.kick.bands.bass.onset > 0) flash();
});
```

### Otros métodos

```javascript
sonic.play()      // Reproduce
sonic.pause()     // Pausa
sonic.seek(time)  // Salta al segundo `time`
sonic.audibleTime // Segundo que SE ESCUCHA ahora (para letra y eventos con tiempo)
sonic.latency     // Latencia de salida que se compensa (s)
sonic.syncOffset  // Cuánto más tarde suenan los stems que el master (s), medido sobre el audio
sonic.getValue(stem) // Últimos datos del stem, mismo formato que onFrame
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

## Cambios v4.3.0

- **Sincronía medida sobre el audio (`syncOffset`)** — con la mezcla por stems (master en silencio como reloj), cada `<audio>` decodifica y busca su MP3 por su cuenta: un stem puede sonar 20–80 ms más tarde que el master aunque `currentTime` diga lo mismo (medido: +7 ms al arrancar, +80 ms después de un salto). Un AudioWorklet compara la envolvente del master con la suma de los stems y, cada segundo, calcula el desfase por correlación (r ≈ 0,95). `currentTime` y `audibleTime` ya lo descuentan cuando lo que suena son los stems.
- El volumen del master se aplica con un `GainNode` (el elemento queda a volumen 1 para poder medirlo aunque esté en silencio).

## Cambios v4.2.0

- **Energía real** — el nivel sale del RMS verdadero de la señal (dBFS), no de un promedio de los bytes en dB del espectro.
- **Bandas por frecuencia real** — bass 20–250 Hz, mid 250 Hz–4 kHz, treble 4–16 kHz (antes "bass" cubría 0–2,2 kHz). FFT de 2048.
- **Stems casi vacíos quedan en 0** — la ganancia automática tiene una referencia absoluta (−24 dBFS): una fuga a −60 dBFS ya no se estira hasta 1.
- **`onset` por stem y por banda** — flujo espectral con umbral adaptativo, calibrado contra los ataques reales de 12 stems (F ≈ 0,9).
- **Compensación de latencia** — los datos llegan cuando su sonido sale por los parlantes (`outputLatency`, ≈ 50 ms en Windows); `audibleTime` para la letra.
- **Un solo bucle** — análisis, efectos DOM y `onFrame` en el mismo cuadro (antes eran dos y podía llegar el cuadro anterior).
- **Suavizado por tiempo** — igual a 30, 60 o 144 fps.
- `data-sonic-track` por defecto (`master`) sigue al stem más fuerte (antes quedaba en 0).
- Pruebas: `npm test` (node:test).

## Cambios v3.1.0

- **Análisis por banda de frecuencia** — bass / mid / treble independientes con noise gate, AGC y curva de potencia propios
- **`data-sonic-band`** — nuevo atributo HTML para dirigir efectos a una banda específica
- **`onFrame` mejorado** — incluye `bands: { bass, mid, treble }` por stem
- **Ruido reducido** — noise gate configurable por stem (`noiseFloor`), AGC desacoplado del silencio, `smoothingTimeConstant` 0.3

---

## Licencia

MIT © 2025 SonicMotion
