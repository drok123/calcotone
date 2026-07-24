# CALCOTONE

CALCOTONE is a browser-based stereo sound-design processor built as a six-module rack: **Ember → Drift → Halo** and **Atmos → Grain → Artifact**, with click-safe reordering inside each rail, an XY Dream Field modulation system, shared Dream Buffer memory, hardware-inspired coloration modes, and lossless 24-bit stereo capture.

## Development

```bash
npm install
npm run dev
```

Before merging a change, run:

```bash
npm run check
```

`check` runs the structural/DSP invariant audit, Oxlint, TypeScript, and the Vite production build.

## Signal-path invariants

The audible master path is intentionally explicit:

`input → stereo matrix → input gain → serial rack → Dream returns → DC block → output makeup → soft ceiling → limiter → analyser/recorder → speakers`

Important rules:

- User gain never occurs after the final master protection stage.
- Hardware/insert coloration uses unity-preserving complementary dry/processed blending; spatial and destructive effects use equal-power wet/dry blending.
- Dream cross-routes are filtered, delayed, hard-capped texture couplings rather than unrestricted feedback paths.
- UI state is authoritative at power-up and is synchronized into the DSP graph before the startup self-check passes.
- Audio topology stays fixed when performance quality changes; quality modes change processing cost, not the signal route.

## Architecture

- `src/audio/` — Web Audio graph, input matrix, recorder, Dream Buffer, DSP effect models and AudioWorklet coordination.
- `public/*processor.js` — realtime AudioWorklet processors. Keep callback work deterministic and allocation-light.
- `src/components/effects/` — rack modules, viewports and shared viewport scheduler.
- `src/components/motion/` — XY Dream Field and motion-route UI.
- `src/ui/` — UI-domain math, motion rules, faceplate layout state and persistence.
- `src/visual/` — analyser-derived visual telemetry shared by the canvas renderers.
- `scripts/audit.mjs` — cheap regression checks for structural and signal-path invariants.

## DSP safety philosophy

CALCOTONE should get strange because the effect model is strange, not because a hidden gain sum, discontinuity, NaN, or runaway loop slipped into the graph. Safety stages are therefore intended to be transparent until needed, while individual algorithms own their musical compression, saturation, feedback character and reconstruction behavior.
