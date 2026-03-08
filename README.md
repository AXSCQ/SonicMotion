# 🎵 SonicMotion.js V3

**Ultra-Lightweight Audio-Reactive UI Library (0 dependencies, ~10KB)** — Convierte tu interfaz web en un visualizador interactivo reaccionando a las frecuencias (stems) de tu música mediante atributos HTML puros.

## ¿Qué es SonicMotion V3?
A diferencia de librerías costosas que analizan un solo archivo `.mp3` de forma imprecisa, SonicMotion V3 utiliza **Audio Stems** (pistas separadas como bajo, batería, voces). 

El servidor reproduce un archivo `master.mp3` de forma audible, mientras los stems (ej. `bass.mp3`, `drums.mp3`) se cargan en paralelo de forma silenciosa. El algoritmo analiza matemáticamente la energía FFT de cada instrumento en tiempo real (60 FPS) y controla tu UI pasándole estos datos.

## Instalación Node.js (Vite, Astro, React, etc.)

```bash
npm install sonicmotion
```

```javascript
import SonicMotion from 'sonicmotion';
```

## Guía de Uso Rápido (Astro, HTML, React)

### 1. Inicializa la Librería
Solamente necesitas apuntar a la ruta de tu track master, y luego definir el nombre y ruta de cada stem.

```javascript
import SonicMotion from 'sonicmotion';

const sonic = SonicMotion.create({
    master: '/music/master.mp3', // Audio que el usuario escuchará
    stems: {
        bass: '/music/bass.mp3', // Audio fantasma para analizar el bajo
        drums: '/music/drums.mp3', // Audio fantasma de la batería
        vocals: '/music/vocals.mp3' // Audio fantasma de las voces
    }
});

sonic.initDOM(); // Pone a la librería a buscar los 'data-sonic' en tu HTML
```

### 2. Escribe los Efectos Customizables
Tú controlas qué hace cada valor matemáticamente en el DOM. Registra tus comportamientos donde quieras. La `intensity` viaja siempre de `0.0` (silencio) a `1.0` (volumen máximo).

```javascript
SonicMotion.registerEffect("glow-anim", (element, intensity) => {
    // Escala del 100% al 120% dependiendo del golpe
    const scale = 1 + (intensity * 0.2); 
    element.style.transform = `scale(${scale})`;
    
    // Brillo intenso en base al volumen
    element.style.boxShadow = `0 0 ${intensity * 40}px rgba(0, 255, 255, ${intensity})`;
});
```

### 3. Integra en tu HTML!
Usa HTML simple. No necesitas complicados renderers en React/Vue.

```html
<!-- Este div bailará cuando la batería suene, ignorando la voz y el bajo (threshold=0.3 bloquea ruido de fondo) -->
<div 
  data-sonic="glow-anim" 
  data-sonic-track="drums" 
  data-sonic-threshold="0.3">
    Sección Batería
</div>
```

### 4. Empieza la Fiesta
Simplemente llama al método asíncrono `play()` después de una interacción del usuario (click/tap) para evitar las restricciones Anti-Autoplay de Web Audio en navegadores modernos.

```javascript
document.getElementById('play-btn').addEventListener('click', () => {
    sonic.play().then(() => console.log("Playing!"));
});
```

## Resumen de Atributos HTML Declarativos

Agrega estos atributos a cualquier etiqueta (`<div>`, `<img>`, `<a>`) en tu DOM:

- `data-sonic="<nombre_efecto>"`: El nombre del efecto registrado con `SonicMotion.registerEffect`.
- `data-sonic-track="<nombre_stem>"`: El identificador del stem que definiste en `.create()` (ej: "bass").
- `data-sonic-threshold="<0.0 - 1.0>"`: Ignora los sonidos con una energía menor a este número. Útil si el stem tiene eco o ruido de fondo para hacerlo reaccionar solo a "golpes fuertes". Ideal entre `0.2` a `0.5`.

Para una lista detallada de los componentes internos y variables matemáticas de SonicMotion, visita [docs/API.md](docs/API.md).
