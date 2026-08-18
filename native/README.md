# CALCOTONE Native Engine

Windows-first native audio backend. The React interface remains a control surface;
audio capture, processing, and playback never enter the browser/webview.

## Current milestone

- allocation-free C++ STACK amp/cab DSP core;
- transport-independent, allocation-free `NativeProcessor` shared by every
  current and future native audio backend;
- deterministic dual-input routing and 90-path native signal test;
- native Ember, Drift, Halo, Atmos, Grain, Artifact, and STOMP rack processors
  with smoothed controls, bounded feedback, click-free bypass state, and
  realtime-safe fixed buffers;
- fixed-memory granular voices for all twelve Grain machines, and fourteen
  Artifact media/console/tape paths including the level-trimmed BCM10 hybrid;
- post-STACK native Pressure dynamics with FET, optical, vari-mu, and VCA
  topologies plus an eight-second native Dream memory return;
- allocation-free `SignalStateBus` reactions: physical Input 2 transients excite
  Grain on the Input 1 lane, Dream GHOST intent adds bounded patina to media/tape
  Artifact models, and Loop's exact reference position anchors Grain, Halo, and
  Drift without clearing their audio memory;
- event-driven `IAudioClient3` capture/render host;
- minimum shared-mode engine periods with raw-mode attempt;
- 64-frame exclusive-WASAPI request with automatic minimum-period clamping and
  safe shared-mode fallback when the driver is busy or rejects its mix format;
- exclusive format negotiation across float32, 24-in-32 PCM, packed PCM24, and
  PCM16 with allocation-free capture/render conversion and alignment retry;
- MMCSS `Pro Audio` realtime threads;
- lock-free stereo capture/render queue with a two-period startup cushion and
  click-safe underrun decay;
- bounded elastic FIFO conversion for independent capture/render clock drift,
  using a continuously ramped ratio and four-point Hermite interpolation instead
  of periodic sample deletion;
- underrun/overrun and negotiated-buffer telemetry;
- console control protocol for STACK parameters.
- packaged desktop faceplate mounted directly from `web/` into a bundled,
  fixed-version WebView2 runtime under `runtime/`; no system browser, installed
  WebView2 runtime, hosted page, or internet connection is part of the product;
- loopback-only internal control bus (port 48157) for commands and telemetry;
  this socket never serves the faceplate and never carries audio;
- independent Input 1 / Input 2 mono-to-stereo lanes with per-STACK assignment;
- equal-power guarded summing after the two lanes are processed.
- allocation-free native guitar tuner on Input 2 with atomic note telemetry.
- two-minute native final-output recorder with a preallocated realtime capture
  buffer, off-thread PCM24 WAV encoding, and RAW/CLEAN/LOUD faceplate exports.
- runtime capture/render device selectors, physical channel mapping, requested
  sample rate and buffer size; no interface model is hardcoded;
- valid 24-bit-in-32 PCM packing for interfaces such as the Revelator io24;
- coherent atomic rack-order publication plus a soft-knee final safety limiter;
- read-only Kernel Streaming/WaveRT filter and pin discovery with an explicit
  WASAPI fallback while experimental WaveRT streaming is being armed.

## Portable DSP validation

```sh
cd native
make test
```

## Windows build

Install Visual Studio 2022 with **Desktop development with C++** and CMake, then:

```powershell
cmake -S native -B native/build -A x64
cmake --build native/build --config Release
.\native\build\Release\calcotone_host.exe
```

Release artifacts include `START-CALCOTONE-NATIVE.bat`. Double-click that launcher.
The host writes `calcotone-native.log` beside itself and shows a Windows popup for
fatal startup errors. CALCOTONE opens its production faceplate in its own desktop
window using the fixed WebView2 runtime shipped inside the package. It does not use
or install a shared system runtime.

The release contains the production faceplate under `web/` and the matching x64
runtime under `runtime/`. Keep both folders beside `calcotone_host.exe`. The desktop
build is compiled in native-only mode: failure to reach the C++ host is a visible
startup error, never a Web Audio fallback. The bridge carries controls and telemetry
only; capture, DSP, Loop memory, recording, and playback remain in the C++ engine.

## Portable product boundary

The faceplate is a packaged HTML/CSS/React control surface, not the audio engine.
Windows mounts it with WebView2; a future iOS build can mount the same production
assets with `WKWebView`, and Android can use the platform WebView. Each platform gets
a small control/telemetry adapter while the allocation-free C++ processors remain the
authoritative audio core behind that adapter. This preserves the approved faceplate
without tying DSP, session timing, Loop memory, or recording to any web runtime.

## Audio device configuration

Run `LIST-CALCOTONE-DEVICES.bat` to print every active Windows capture and render
endpoint and its stable device ID. Edit `CALCOTONE-AUDIO-CONFIG.bat` to choose a
device by full ID or a unique part of its friendly name. The same file controls:

- `CALCOTONE_AUDIO_BACKEND`: `auto`, `wasapi`, or experimental `ks-wavert`;
- `CALCOTONE_AUDIO_MODE`: `exclusive` or `shared`;
- `CALCOTONE_BUFFER_FRAMES`: requested frames, clamped to the driver's limits;
- `CALCOTONE_SAMPLE_RATE`: requested exclusive-mode rate, or blank to follow the device;
- Input 1/Input 2 and left/right output channel numbers, using one-based labels.

`auto` performs a read-only KS/WaveRT capability probe and runs the proven WASAPI
transport. Requesting `ks-wavert` currently reports filter/pin eligibility in the
health panel and log, then falls back to WASAPI. It never opens an unvalidated
stream or leaves the interface in a partially configured state.

Match the input and output device formats in Windows Sound settings (48 kHz is
recommended for the first hardware run). Start with speakers/monitor volume low.
The host primes capture before render by two negotiated device periods so the
independent WASAPI event threads do not race at startup. The printed and health-panel
path estimate includes this cushion. Type `stats` after playing for 20 seconds to
inspect `underruns`, `overruns`, `ringFrames`, and `fifoTargetFrames`; use `quit` to
stop cleanly.

`ringFrames` should remain close to `fifoTargetFrames` over long sessions. The host
trims startup overshoot to the exact target and reports `clockCorrections`,
`fifoReadRatio`, `ringHighWaterFrames`, capture discontinuities/API errors,
input/output peaks, limiter activity, `renderDeadlineMisses`, and
`maxRenderMicros` so clock mismatch, gain clipping, driver discontinuities, and
DSP work that misses a device deadline can be distinguished from one another.

The launcher requests exclusive mode first. When both endpoints accept it, the
health panel reports `exclusive` and the path estimate uses the actual negotiated
buffers. If either device refuses exclusive access, Calcotone reactivates a clean
audio client and falls back to the lowest shared `IAudioClient3` period instead of
failing startup. Close DAWs or other apps holding the interface if you want the
lowest exclusive period.
Both endpoint log sections list every rejected exclusive format and its HRESULT,
which distinguishes disabled/busy exclusive access from a driver format mismatch.

The bridge never carries audio or UI assets. `GET http://127.0.0.1:48157/health`
returns negotiated device periods, FIFO depth, and dropout counters. The packaged
faceplate serializes plain-text commands such as `drive 0.5` to `POST /command` so
the full rack state arrives intact during startup. The listener binds only to
`127.0.0.1` and accepts the packaged `https://app.calcotone` origin. There is no
external-browser launch mode or browser fallback in the production host.

The faceplate sends rack controls through three text commands: `param <module>
<parameter> <value>`, `moduleBypass <module> <0|1>`, and `order <modules...>`.
The native rack covers Ember (`saturation`), Drift (`chorus`), Halo (`delay`),
Atmos (`reverb`), Grain (`bitcrusher`), Artifact (`media`), and the fourteen-mode
STOMP hybrid pedal bank. STACK participates in the same atomic serial order, so
cross-rail moves alter the C++ topology instead of leaving the amp fixed at the end.
STOMP splices pedal-specific filter/gain profiles with stateful device memory,
supply sag, Hermite-LUT nonlinear stages, and 2× midpoint antialiasing. Grain,
Artifact, Pressure, and Dream Buffer use startup-allocated native memory and never
allocate from the realtime render thread.

The signal-state reactions are deliberately not hidden knob automation. Guitar
activity is capped at 0.35 before Grain applies its own smaller density/transient
range; Dream can add at most 0.12 effective Wear and cannot alter console, capture,
or dynamics models. Loop synchronization carries sample position plus cycle length
into each rack sub-block. Grain resets only its event schedule, while Halo and Drift
use an 8% phase pull at each boundary, preserving delay, feedback, rotor, and memory
buffers so synchronization cannot create a hard reset click.

The native science engine builds on that bus without changing the faceplate or
turning the desktop control bridge into an audio path:

- **Circuit DNA** continuously characterizes each active rack module's drive,
  spectral color, dynamics, and short memory from its existing dry/wet blocks.
  Its slow unity calibration is limited to ±3% and requires no retained audio.
- **Dual-input cross-resynthesis** transfers Input 2 pitch and brightness into
  Grain events on the Input 1 lane. It cannot synthesize sound from silence.
- **Loop resynthesis** reads only a next-block energy/transient/brightness/width
  sideband from stored playback. Loop still adds the original stored float samples
  directly after Dream/rack processing at their exact saved level and polarity.
- **Topology morphing** uses a maximum 0.10-radian orthonormal lane rotation before
  Grain, producing a continuous independent-to-cross-coupled transition while
  preserving the two-lane signal energy.
- **Adaptive fidelity** receives render timing from the WASAPI host, reacts quickly
  to deadline pressure, and recovers only after sustained headroom. It caps STACK
  quality at 4×/2×/1× and Grain at 8/6/4 voices without allocating or reading a
  wall clock inside DSP code.

The `health` response exposes the controller tier/load, lane-one Grain DNA, and
Loop analysis values as control telemetry only; the bridge never carries samples.

`stackInput 0` assigns STACK to Input 1, `stackInput 1` assigns it to Input 2,
and `stackInput 2` processes both lanes through independent STACK instances. A lane
not assigned to STACK remains dry, so a tablet can stay clean on Input 1 while a
guitar uses STACK on Input 2. The faceplate exposes these choices directly.

The launcher requests exclusive WASAPI and retains the minimum-period shared path as
its compatibility fallback. A dedicated ASIO backend remains the next interface-
specific latency step after the WASAPI path is stable on hardware.
