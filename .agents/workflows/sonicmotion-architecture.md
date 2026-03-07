---
name: sonicmotion-architecture
description: Architecture definition for SonicMotion v3 - Synchronized multi-track audio reactive animations
---

# SonicMotion v3 Architecture

This document defines the core architecture and logic for SonicMotion v3. Use this as a reference whenever refactoring or working on the library's foundation.

## Core Concept
SonicMotion visually reacts to individual instruments (stems) of a song while the user only hears the complete mixed track. 

This creates the illusion that the UI is "listening" to the separated instruments in real-time.

## The Audio Engine (The Orchestra)
- **Master Audio:** A single `<audio>` element that plays the mixed track. This is the **only** audible track.
- **Stem Tracks:** Multiple `<audio>` elements loaded with isolated instrument tracks. These are **muted** (inaudible).
- **Analysis:** Each stem track is connected to its own `AnalyserNode` within an `AudioContext` to continuously read its global intensity (0.0 to 1.0).

## Synchronization Strategy (The Master Clock)
The hardest part of this architecture is ensuring the muted stem tracks never drift out of sync with the audible master track.
- **Play/Pause:** Firing `play()` or `pause()` on the library must trigger a `Promise.all` that plays/pauses the master and all stems simultaneously.
- **Seek:** When the user scrubs the timeline (listens to the `timeupdate` or `seeking` events of the master track), the library must force the `currentTime` of all stem tracks to match the master's `currentTime`.
- **Drift Correction:** During the `requestAnimationFrame` loop, the library should check if any stem track's `currentTime` drifts by more than `0.05` seconds compared to the master. If it drifts, it must be re-aligned `stem.currentTime = master.currentTime`.

## DOM Integration (HTML Configuration)
The library interacts with the DOM using a simple data-attribute API, heavily inspired by AOS (Animate On Scroll).

Users define the target stem (`data-sonic-track`), the animation effect (`data-sonic`), and the intensity threshold (`data-sonic-threshold`).

### Example Usage:
```html
<!-- Scales the div only when the 'kick' stem intensity exceeds 80% -->
<div data-sonic="scale" data-sonic-track="kick" data-sonic-threshold="0.8">
    Jump on Drop
</div>

<!-- Glows continuously as long as the 'vocals' stem is above 20% -->
<h1 data-sonic="glow" data-sonic-track="vocals" data-sonic-threshold="0.2">
    Vocal Echo
</h1>
```

## The Animation Loop
1. Inside a `requestAnimationFrame` loop, calculate the current intensity (0-1) for every stem using their respective `AnalyserNode`.
2. Find all DOM elements with the `[data-sonic]` attribute.
3. For each element, read its requested track and threshold.
4. If the track's current intensity > threshold, calculate the animation multiplier and apply the specified CSS transform/filter.
5. If the intensity drops below the threshold, gracefully transition the element back to its original state.
