# CALCOTONE Art + DSP Direction

This document is the design contract for the next stage of CALCOTONE.

## Dream Field: one painting, six owners

The XY artwork remains one coherent surreal landscape. Effects do not spawn independent visualizers on top of it. Each module permanently owns one physical layer of the same world:

1. **Ember** — central sun / eclipse, radiance, corona and rings.
2. **Drift** — water surface, waves, reflections and refraction.
3. **Halo** — mountains, horizon silhouettes and distant depth geometry.
4. **Atmos** — clouds, fog, sky volume, aurora and celestial atmosphere.
5. **Grain** — rain, ash, crystal debris and reconstruction weather.
6. **Artifact** — global image degradation, analog memory and glitch treatment.

XY movement changes composition and perspective. Module parameters change the material and intensity of the layer that module owns.

### Dropdown rule

Every dropdown may have its own artwork, but only inside its owned layer.

Examples:

- Halo Clean = smooth distant ridge layers.
- Halo BBD = stepped / terraced mountains.
- Halo Scatter = fragmented spires.
- Halo Constellation = mountain peaks with restrained horizon lights.
- Drift Liquid = fluid painterly water.
- Drift Rotary = circular eddies.
- Ember Furnace = turbulent hot corona.
- Atmos Aurora = aurora ribbons.
- Grain Prism = refracted rain.
- Artifact VHS = horizontal tracking instability.

The scene must remain recognizable as one place when dropdowns change.

## Grain: pitch and reconstruction are separate concepts

Grain must remain useful as a signal reconstruction/destruction processor without mandatory repitching.

The existing Pitch control follows this contract:

- **Pitch = 0**: unity-pitch reconstruction. Interval and fine-pitch transposition are disabled.
- **Pitch > 0**: progressively opens CALCOTONE's interval and fine-pitch grain behavior.

Pitch zero does **not** bypass the granular processor. Density, temporal scatter, chaos, bit depth, bloom, mode-specific destruction, stereo movement and reverse grains remain available.

## DSP model taxonomy

CALCOTONE dropdowns should belong to one of two categories:

### Original processes

A deliberate signal-processing idea invented for CALCOTONE, such as Grain Reconstruct, Atmos Nebula or Drift Liquid.

### Hardware / process models

A deliberate recreation of a real device, circuit or medium. These are not generic flavor labels.

A hardware model should reproduce as much of the real signal path as practical:

- gain staging / headroom
- frequency response
- nonlinear transfer behavior
- frequency-dependent saturation
- compression / recovery behavior
- feedback topology
- modulation / clock behavior
- channel interaction
- noise and transport behavior when materially relevant

Do not implement a named machine as "EQ + hiss + waveshaper" and call it finished.

## Hardware modeling workflow

### 1. Identify the exact target

Use the actual model / revision when possible. Do not guess a circuit from a family name.

### 2. Recreate topology

Use service manuals, schematics and reliable technical documentation to recreate the important signal stages.

### 3. Measure / calibrate

When hardware or trustworthy captures are available, compare:

- swept frequency response
- stepped input levels
- harmonic spectra at multiple frequencies / gains
- impulse and transient behavior
- noise floor / bandwidth
- modulation / transport timing
- stereo interaction

### 4. Musical verification

Validate on drums, bass, synths, vocals and full mixes. A model should have a recognizable operating range, not only match one laboratory condition.

### 5. Expose simple controls

The model may contain many internal variables while the CALCOTONE panel remains simple. Controls should operate meaningful groups of real behaviors rather than expose every component.

## Artifact: hardware-media laboratory

Artifact is the natural home for machines whose identity comes from recording / playback media and front-end electronics.

A future four-track model should be based on an **exact selected Tascam unit**, not a generic four-track caricature.

Candidate behavior to model after the exact unit is selected:

- input / preamp gain and clipping transition
- frequency-dependent preamp saturation
- EQ / tone path interaction
- cassette record / playback bandwidth
- head and tape saturation
- transport wow / flutter
- noise / crosstalk where musically relevant
- output stage coloration

A control such as Tone may intentionally move through more than static EQ if the real machine's gain structure makes the upper range drive the preamp harder. The user should hear the machine's signature operating behavior, not merely a renamed generic parameter.

## Other obvious hardware-model homes

### Ember

Preamps, console channels, transformers, tube stages and other nonlinear circuits.

### Drift

BBD chorus, ensemble circuits, dimensional modulation, vibrato and rotary systems.

### Halo

Tape echo, BBD delay, multi-head echo and other repeat / feedback hardware.

## Product rule

**No dropdown exists just because CALCOTONE can make another sound.**

Every dropdown should be either:

1. a deliberate original processing concept, or
2. a deliberate recreation of a real device / circuit / medium.

The same rule applies visually: each dropdown must strengthen the identity of the module's owned Dream Field layer without turning the XY artwork into a pile of unrelated effects.
