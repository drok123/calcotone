# Model D SPICE calibration

CALCOTONE keeps circuit simulation out of the realtime callback. The browser
AudioWorklet uses a fixed-cost, four-stage BJT/capacitor micro-model; ngspice is
the offline reference used to measure where that approximation drifts.

## Run it

```bash
npm run audit:spice
```

This always runs seven direct probes through the exact `spiceLadder()` method
used by the AudioWorklet. If `ngspice` is on `PATH`, it also renders the matching
netlist and compares gain, phase, peak level, THD, and DC.

Use the strict command in a calibration environment or CI image where ngspice
is installed:

```bash
npm run audit:spice:strict
```

The `Calcotone Check` GitHub Actions workflow installs the Ubuntu ngspice
package and runs this strict command in its own `Model D ngspice calibration`
job. The general browser build remains separate, so a reference mismatch is
reported as a circuit-calibration failure rather than a generic application
failure.

Machine-readable output is available with:

```bash
node scripts/model-d-spice-calibration.mjs --json
```

## What is modeled

The reference fixture and realtime solver share the same control mapping:

- four explicit 68 nF integration capacitors;
- tail-current-derived transconductance;
- temperature-dependent junction voltage;
- a matched Shockley-junction differential-pair transfer at every pole;
- resonance feedback from the fourth pole;
- input and output saturation around the physical-voltage core.

The worklet additionally supports deterministic per-voice capacitor tolerance,
transistor mismatch, rail sag, oversampling, and bounded Newton iterations.
Those production variations are reset to nominal during calibration so the
comparison isolates numerical error.

## Calibration cases and limits

The seven probes cover low, middle, and high cutoff positions; low and high
resonance; warm drive; hard drive; and a 42 °C junction case. The current guard
bands are:

| Metric | Maximum difference |
| --- | ---: |
| Fundamental gain | 3 dB |
| Fundamental phase | 35° |
| Peak level | 3 dB |
| THD | 12 percentage points |
| DC | 0.02 |

These are first-pass behavioral bounds, not claims that the synth is already a
component-for-component Model D clone. Tightening them should follow captured
hardware measurements or a vetted transistor-level netlist.

The fixture uses ngspice batch mode and `wrdata`, as documented in the
[ngspice user manual](https://ngspice.sourceforge.io/docs/ngspice-manual.pdf).
