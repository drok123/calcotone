# CALCOTONE

CALCOTONE is a browser-based stereo multi-effects workstation built with React, TypeScript, Vite, and the Web Audio API.

The instrument currently centers on six effect modules arranged across two fixed three-slot routing rails:

- Rail A: Ember → Drift → Halo
- Rail B: Atmos → Grain → Artifact

Each rail can be reordered while preserving its membership. The workstation also includes musical parameter randomization, signal-order randomization, XY modulation patching, adaptive SAFE quality management, DSP profiling, a Dream Buffer side-path system, and stereo WAV recording.

## Development

```bash
npm ci
npm run dev
```

Useful checks:

```bash
npm run audit
npm run lint
npm run build
```

`npm run audit` performs CALCOTONE-specific structural checks, including worklet syntax, routing invariants, default effect power state, and other regression guards.

## Current workflow

The `main` branch is the canonical CALCOTONE source. Changes should be audited for UI/state consistency before the final DSP-focused pass.
