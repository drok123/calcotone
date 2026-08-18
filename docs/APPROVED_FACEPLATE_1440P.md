# Approved 1440p Faceplate Contract

The approved Windows faceplate is the `web` directory from
`calcotone-native-windows-optimized(2).zip`, approved on 2026-08-10. Its
artifact SHA-256 is
`0794b30299464728ff0eae1e547abd2a1c998700c27451b13e7f74f9e35daa7b`.

The approved assets were reproduced from source commit
`9cfc06a2257f8616a1315818f8e9b00d19029910`:

- `web/assets/index-C0nz9bUo.js` — SHA-256
  `6ea5b9c35122aee0678a1e1a77de2b63cec6929496d0ccb0b11915698b7fffe4`
- `web/assets/index-RnBl5-PK.css` — SHA-256
  `2cb7aef4edfe10696df8b88fc855bbedbb1f58ea7223802722f1e2e7962e7564`

## Factory geometry

- Geometry revision: `2026-08-09-railc-latest-loop-centered-v4`.
- Reference display: 2560 × 1440.
- Every module viewport is 168 px and every module stage is 304 px.
- Core knobs use y = 224 and normalized x positions 0.0952380952,
  0.2142857143, 0.3333333333, 0.6785714286, 0.7976190476, and
  0.9166666667.
- Stomp knobs use y = 224 and normalized x positions 0.0818713450,
  0.2105263158, 0.3274853801, 0.6549707602, 0.7719298246, and
  0.8888888889.
- Stack knobs use y = 240 and normalized x positions 0.1169590643,
  0.3742690058, 0.6432748538, and 0.8888888889.
- Loop faders use y = 216 and normalized x positions 0.1432748538,
  0.3888888889, 0.6345029240, and 0.8567251462.
- Loop track pads use the same x positions at y = 272.
- The snap grid is 8 px.

## Recovery rule

The geometry revision remains v4. Storage epoch
`2026-08-17-known-good-faceplate-recovery-v1` replaces any layout persisted by
earlier builds once, including malformed geometry that was already stamped as
v4. User edits made after the recovery remain persistent.

## Layering and exclusions

`approvedFaceplate.css` owns shared geometry. `ModulePowerState.css` loads after
it and may change material/power appearance without changing dimensions.
Feature-specific header styling, including Microcosm, remains in separate style
layers and must not modify the shared module-screen or knob coordinates.

XY is permanently retired. Do not restore its UI, DSP, routing, serialization,
patch jacks, or compatibility behavior while preserving the approved geometry.
