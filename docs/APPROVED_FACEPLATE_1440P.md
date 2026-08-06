# Approved 1440p Faceplate Contract

The Windows faceplate packaged in `CALCOTONE-Windows-DSP-QA(1).zip` is the visual and geometric source of truth for this milestone.

## Factory geometry

- Reference display: 2560 × 1440.
- All module viewports: 168 px.
- All module stages: 304 px.
- Core module knob row: y = 224 with the six uploaded normalized x positions.
- Stomp knob row: y = 224 with its six uploaded normalized x positions.
- Stack knob row: y = 216 with its four uploaded normalized x positions.
- Pressure knob row: y = 216 with its four uploaded normalized x positions.
- Pressure button row: y = 278 at x = 0.14, 0.38, 0.62, and 0.86.
- Snap grid: 8 px.

## Migration rule

Factory revision `2026-08-06-uploaded-approved-faceplate-1440p-v1` replaces stale saved geometry once so an older local layout cannot silently restore the reverted 292 px chassis or y = 246 control row.

## Fidelity layer

The faceplate geometry is independent from the 1440p rendering tier. High-DPI canvas backing, adaptive 45/30 FPS scheduling, crisp typography, and automatic visual fallback remain enabled without changing the approved control placement.
