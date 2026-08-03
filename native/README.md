# CALCOTONE Native Engine

Windows-first native audio backend. The React interface remains a control surface;
audio capture, processing, and playback never enter the browser/webview.

## Current milestone

- allocation-free C++ STACK amp/cab DSP core;
- deterministic dual-input routing and 90-path native signal test;
- native Ember, Drift, Halo, Atmos, and STOMP rack processors with smoothed controls,
  bounded feedback, click-free bypass state, and realtime-safe fixed buffers;
- event-driven `IAudioClient3` capture/render host;
- minimum shared-mode engine periods with raw-mode attempt;
- 64-frame exclusive-WASAPI request with automatic minimum-period clamping and
  safe shared-mode fallback when the driver is busy or rejects its mix format;
- exclusive format negotiation across float32, 24-in-32 PCM, packed PCM24, and
  PCM16 with allocation-free capture/render conversion and alignment retry;
- MMCSS `Pro Audio` realtime threads;
- lock-free stereo capture/render queue;
- underrun/overrun and negotiated-buffer telemetry;
- console control protocol for STACK parameters.
- loopback-only HTTP control bridge for the React/native-shell UI (port 48157).
- independent Input 1 / Input 2 mono-to-stereo lanes with per-STACK assignment;
- equal-power guarded summing after the two lanes are processed.
- allocation-free native guitar tuner on Input 2 with atomic note telemetry.

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

Release artifacts include `START-CALCOTONE-NATIVE.bat`. Double-click that launcher
instead of opening the executable directly. It keeps the window visible on failure,
while the host writes `calcotone-native.log` beside itself and shows a Windows popup
for fatal startup errors.

The release also contains the production faceplate under `web/`. Once WASAPI and
the control bridge are active, the host opens its own `http://127.0.0.1:<port>/`
faceplate automatically. Use that tab for native mode; it is same-origin with the
bridge and does not depend on StackBlitz, CORS, iframe permissions, or hosted-page
local-network access.

Match the input and output device formats in Windows Sound settings (48 kHz is
recommended for the first hardware run). Start with speakers/monitor volume low.
The host prints the actual periods and estimated native path before accepting
commands. Type `stats` to inspect dropouts and `quit` to stop cleanly.

The launcher requests exclusive mode first. When both endpoints accept it, the
health panel reports `exclusive` and the path estimate uses the actual negotiated
buffers. If either device refuses exclusive access, Calcotone reactivates a clean
audio client and falls back to the lowest shared `IAudioClient3` period instead of
failing startup. Close DAWs or other apps holding the interface if you want the
lowest exclusive period.
Both endpoint log sections list every rejected exclusive format and its HRESULT,
which distinguishes disabled/busy exclusive access from a driver format mismatch.

The bridge never carries audio. `GET http://127.0.0.1:48157/health` returns the
negotiated device periods and dropout counters. Send a plain-text command such as
`drive 0.5` to `POST /command`. Browser origins are restricted to loopback hosts;
the server itself binds only to `127.0.0.1`.

Hosted Calcotone previews must be opened in their own browser tab; an embedded
StackBlitz iframe cannot request loopback access under modern browser permissions.
Allow loopback/local-network access if the browser prompts. The bridge accepts
Calcotone's StackBlitz/WebContainer preview origins and logs any denied origin in
the native console so a fallback can no longer fail silently.

The faceplate sends rack controls through three text commands: `param <module>
<parameter> <value>`, `moduleBypass <module> <0|1>`, and `order <modules...>`.
The first native migration batch covers Ember (`saturation`), Drift (`chorus`),
Halo (`delay`), Atmos (`reverb`), and the fourteen-mode STOMP hybrid pedal bank.
STOMP splices pedal-specific filter/gain profiles with stateful device memory,
supply sag, Hermite-LUT nonlinear stages, and 2× midpoint antialiasing. Grain,
Artifact, Pressure, and Dream Buffer remain on the migration checklist and are not represented as
native-complete until their DSP and parity tests land.

`stackInput 0` assigns STACK to Input 1, `stackInput 1` assigns it to Input 2,
and `stackInput 2` processes both lanes through independent STACK instances. A lane
not assigned to STACK remains dry, so a tablet can stay clean on Input 1 while a
guitar uses STACK on Input 2. The faceplate exposes these choices directly.

Shared low-period `IAudioClient3` is the default because it can approach exclusive
latency without seizing the device. Exclusive WASAPI and ASIO remain backend options
after the shared-period hardware measurements are known.
