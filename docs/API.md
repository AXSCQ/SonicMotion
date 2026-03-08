# SonicMotion V3 API & Architecture Documentation

Este documento detalla la estructura principal del código fuente en `src/`, las variables utilizadas y el ciclo de vida de los componentes.

## 1. Módulos Internos

El código fuente está dividido en tres clases/archivos que cumplen el principio de responsabilidad única (Single Responsibility Principle).

### `stem-manager.js` (SyncAudioManager)
Encargado puramente de cargar el Audio (buffer y elementos HTML5), sincronizar la pista maestra y extraer las frecuencias (GainNode/AnalyserNode).

#### Variables Clave
- `this.masterAudio`: Elemento `<audio>` (HTML5) que reproduce la pista principal ("master") y se escucha en los altavoces.
- `this.stems`: Mapa `Map<string, Object>` donde cada `Object` representa un "stem" (ej. bajo, batería) con sus nodos WebAudio (`.audio`, `.mediaSource`, `.analyser`, `.silentGain`).
- `this.ctx`: `AudioContext` de la Web Audio API, el motor principal donde viajan los datos.
- `analyser.fftSize = 512`: Determina la resolución del análisis de frecuencias. Un valor bajo (512) nos da una menor precisión de ecualización pero una reacción de latencia mucho más rápida.
- `silentGain`: Un hack específico (Gain a `0.000~1`) usado en Chrome/Chromium para que el buffer de audio suene el Stem sin enviarlo a los altavoces, previniendo que Chromium bloquee los datos de FFT de audios invisibles.

#### Funciones Principales
- `addStem(name, source)`: Conecta un `.mp3` al AnalyserNode y GainNode, sin que el usuario lo escuche.
- `play()`: Devuelve una Promesa. Asegura que el `masterAudio` y todas las pistas de la colección `this.stems` se reproduzcan de forma exactamente sincrónica usando `Promise.allSettled`.
- `update()`: Se ejecuta 60 veces por segundo. Recorre cada Analyser para capturar un arreglo de sub-frecuencias (`Uint8Array`) y páselas a `EnergyAnalyzer.js` para extraer un único número.

---

### `energy-analyzer.js` (EnergyAnalyzer)
Responsable única y exclusivamente de convertir un arreglo gigante de 512 bytes crudos de frecuencias de sonido en un único número amigable `0.0` a `1.0`.

#### Variables Clave
- `this.attack = 0.8`: Qué tan rápido sube la animación. (0.01 = lento, 1.0 = instantáneo).
- `this.release = 0.92`: Qué tan rápido baja o se relaja la animación (decaimiento).
- `this.minDb` y `this.maxDb`: Rangos de decibelios para saber qué tanto ruido considerar silenco absoluto y qué tanto volumen es volumen máximo del stem.

#### Funciones Principales
- `analyze(frequencyData)`: Recibe el Array `[21, 44, 255, 100, 0, 0...]`. Calcula el promedio (Root Mean Square - "RMS") y el pico más agudo. Aplica una curva logarítmica y suavizada de ataque/liberación ("smoothing"), y la constriñe estrictamente en el rango de `0` a `1`.

---

### `effects-controller.js` (EffectsController)
Conecta las matemáticas de `EnergyAnalyzer` con el aspecto visual del DOM (el HTML y CSS).

#### Variables Clave
- `this.effects = {}`: Diccionario en memoria que guarda todas las funciones de `registerEffect()` que hayan sido configuradas desde el Frontend por los usuarios.
- `this._bindings = []`: Arreglo de elementos HTML en tiempo de ejecución que fueron encontrados usando el atributo `[data-sonic]`. Cada Binding sabe qué *Efecto*, qué *Stem* usar, y el *Threshold*.

#### Funciones Principales
- `parseDOM()` / `_parseAttributes()`: Busca en toda la página usando `document.querySelectorAll("[data-sonic]")`.
- `register(name, fn)`: Guarda las instrucciones matemáticas de CSS que un desarrollador decida inyectar. (Astro/React llama esta función).
- `update(stemDataMap)` / Loop: Ocurre en cada fotograma del visor (`requestAnimationFrame`). Revisa si la "energía calculada" del fotograma actual superó el `data-sonic-threshold` que el usuario indicó en su HTML.
  - Si no lo superó, re-establece la intensidad a 0.
  - Si lo superó, ejecuta la función guardada en `this.effects[name]` inyectando el elemento HTML y la `intensity`.

---

## 2. Archivo Principal: `sonicmotion.js`
Es la clase "Facade" o Interfaz del desarrollador. Funciona como puente. Expone los métodos `play()`, `pause()` y `initDOM()`. Es el puente que el compilador empaqueta y publica en NPM.

```txt
SonicMotionInstance
|-- AudioManager ---> Llama WebAudio, carga MP3s, extrae Arrays de Picos
|-- EnergyAnalyzer -> Convierte Picos a variables "Intensidad 0.0 ~ 1.0"
|-- EffectsController --> Busca "data-sonic", inyecta Intensidad como Transform CSS.
```
