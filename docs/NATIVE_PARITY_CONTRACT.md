# CALCOTONE Native Parity Contract

## Canonical product

The production React/TypeScript StackBlitz implementation is the canonical CALCOTONE behavior until every item in this contract passes. The Windows host is a transport and native DSP migration of that product, not a reinterpretation.

A native feature is not complete because it has the same label, parameter count, or broadly similar sound. It is complete only when its state, interaction, routing, timing, audio topology, parameter mapping, gain behavior, persistence, and rendered output match the canonical implementation within the defined tolerances.

## Non-negotiable parity scope

### Interface and interaction

- Exact module set, rail membership, ordering, movement, serialization, and restore behavior.
- Exact dropdown contents and stable indices used by presets.
- Exact initial values, enabled states, availability states, labels, displays, units, tapers, and smoothing times.
- Knob, button, dropdown, wheel, drag, resize, fullscreen, sequencer, chaining, note-extension, chord, randomization, mutation, and layout-editor behavior.
- Exact startup synchronization: native output remains safely muted until the complete canonical state has been published.
- Exact patch recall, local persistence, random profile behavior, signal randomization, and third-rail serialization.
- Exact recorder, tuner, meters, spectra, visualizer control state, and native health presentation.

### Routing and engine state

- Exact dual-input routing, stack/stomp assignment, mono-to-stereo behavior, serial order, bypass law, and equal-power summing.
- Exact active/idle behavior and no hidden always-on native processors unless the canonical engine also runs them.
- Exact wet/dry topology and equal-power or linear mix law used by each canonical module.
- Click-free state transitions must preserve the canonical target sound rather than substitute a different topology.

### DSP and model behavior

For every dropdown model, port all canonical stages rather than sharing a generic approximation unless the canonical implementation itself shares them:

- nonlinear devices and lookup curves;
- SPICE-inspired and hybrid hardware stages;
- preamp, transformer, tube, diode, transistor, console, converter, tape, and media paths;
- filter type, order, cutoff mapping, resonance, damping, and state topology;
- delay-line count, lengths, interpolation, cross-coupling, diffusion, modulation, feedback, saturation, and stability limits;
- oversampling and antialiasing behavior;
- detector, envelope, attack/release, ratio, knee, makeup, and topology behavior;
- noise, wow/flutter, wear, memory, sag, bias, hysteresis, and stochastic behavior;
- model-specific input trims, output trims, loudness normalization, and headroom;
- exact parameter ranges, tapers, unit conversion, smoothing, and modulation depth;
- sample-rate-dependent coefficients and deterministic seeded behavior where applicable.

### Canonical module sources

The parity implementation must be derived directly from the current canonical files, including at minimum:

- `src/audio/effects/Saturation.ts` — Ember
- `src/audio/effects/Chorus.ts` — Drift
- `src/audio/effects/Delay.ts` — Halo
- `src/audio/effects/Reverb.ts` — Atmos
- `src/audio/effects/Bitcrusher.ts` — Grain
- `src/audio/effects/Media.ts` — Artifact
- STACK, STOMP, Pressure, Dream Buffer, synth, input matrix, routing, preset, serialization, randomization, and recorder sources under `src/audio`, `src/features`, `src/routing`, and `src/components`
- `src/App.tsx` for canonical startup, state publication, UI interaction, and integration behavior

Names here describe ownership, not permission to simplify. If canonical behavior is distributed across helpers or worklets, those dependencies are part of the port.

## Known native gaps at contract creation

The current native rack is a functional native interpretation but not full parity:

- Atmos uses a common four-line feedback-delay structure, while the canonical engine defines twelve distinct model profiles with different line counts and times, predelay, size ranges, decay and damping biases, diffusion, modulation, cross-coupling, early reflections, dynamics, high-pass behavior, converter stages, dispersion, split decay, and gain trims.
- Ember, Drift, and Halo currently share broad native structures across many dropdowns, with only coefficient or routing variations where the canonical engines contain deeper model-specific processing.
- Artifact and Grain contain more dedicated native work but still require formal topology, parameter, state, and render comparison.
- Native startup state has been made safe, but complete bidirectional state synchronization and UI parity still require formal tests.

No known gap may be described as parity until measured and accepted under this contract.

## Migration order

1. Build the parity harness and canonical state manifest.
2. Atmos, because its audible and structural gap is currently largest.
3. Ember.
4. Drift.
5. Halo.
6. Artifact.
7. Pressure and Dream Buffer.
8. STACK and STOMP.
9. Grain verification and calibration.
10. Synth, sequencer, recorder, tuner, routing, randomization, serialization, layout editor, and every remaining UI workflow.
11. Complete end-to-end preset and project recall verification.

The order may change for dependencies, but no module is skipped.

## Required automated validation

### State-contract tests

For every canonical parameter and model:

- stable model index and name;
- default, minimum, maximum, taper, unit, and smoothing time;
- bypass and enabled default;
- serialized representation and restore result;
- command publication to the native bridge;
- startup and reconnect synchronization.

### Render fixtures

Generate deterministic canonical and native renders at 44.1, 48, and 96 kHz using:

- impulses;
- logarithmic sweeps;
- stepped sines;
- dual-tone and intermodulation signals;
- noise bursts;
- bass, guitar, drums, synth chords, and transient-heavy musical fixtures;
- silence for noise/self-oscillation validation;
- parameter automation and bypass transitions.

Each fixture must retain the canonical input, parameter state, canonical output, native output, and comparison report.

### Acceptance metrics

A model passes only when all relevant checks pass:

- no NaN, infinity, unbounded feedback, discontinuity, or unexpected self-oscillation;
- exact state and routing parity;
- delay, predelay, envelope, and modulation timing within one sample where the implementations are intended to be identical;
- frequency response, decay curve, dynamics, nonlinear transfer, stereo correlation, and integrated loudness within model-specific tolerances recorded beside the fixture;
- blind listening confirms no unexplained tonal or behavioral mismatch;
- any intentional native improvement is explicitly approved and represented as a selectable enhancement, not silently substituted for canonical behavior.

A single broad correlation number is not sufficient for nonlinear, stochastic, modulated, or time-varying effects.

## Architecture rule

Canonical model metadata must move toward one shared machine-readable source of truth. TypeScript UI definitions and C++ native definitions must be generated from or validated against that source so dropdown order, parameter mappings, defaults, and model identity cannot drift independently.

DSP implementations may remain language-specific, but their declared topology and calibration data must be traceable to the same model identifier and version.

## Stable audio transport baseline

During parity work, the validated Revelator configuration is:

- WASAPI shared mode;
- physical `Mic/Inst 1/2` capture;
- physical `Main Out` render;
- user-validated clean operation down to at least a 96-frame request;
- exclusive PCM24-in-32 remains experimental until its packing and hardware behavior are separately validated.

Transport optimization must not be mixed with model-parity judgments.

## Definition of done

The native build is fully parity-complete only when:

- every canonical UI workflow is present and behaves identically;
- every preset and serialized project restores identically;
- every dropdown maps to its complete canonical audio model;
- all hybridization and emulation enhancements are present;
- automated state and render parity suites pass;
- the Windows artifact contains the complete faceplate and native engine with no StackBlitz or browser dependency;
- no known difference remains undocumented and explicitly approved.
