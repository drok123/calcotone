# CALCOTONE Native Engine

Windows-first native audio backend. The React interface remains a control surface;
audio capture, processing, and playback never enter the browser/webview.

## Current milestone

- allocation-free C++ STACK amp/cab DSP core;
- deterministic dual-input routing and 90-path native signal test;
- event-driven `IAudioClient3` capture/render host;
- minimum shared-mode engine periods with raw-mode attempt;
- MMCSS `Pro Audio` realtime threads;
- lock-free stereo capture/render queue;
- underrun/overrun and negotiated-buffer telemetry;
- console control protocol for STACK parameters.
- loopback-only HTTP control bridge for the React/native-shell UI (port 48157).
- independent Input 1 / Input 2 mono-to-stereo lanes with per-STACK assignment;
- equal-power guarded summing after the two lanes are processed.

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

Match the input and output device formats in Windows Sound settings (48 kHz is
recommended for the first hardware run). Start with speakers/monitor volume low.
The host prints the actual periods and estimated native path before accepting
commands. Type `stats` to inspect dropouts and `quit` to stop cleanly.

The bridge never carries audio. `GET http://127.0.0.1:48157/health` returns the
negotiated device periods and dropout counters. Send a plain-text command such as
`drive 0.5` to `POST /command`. Browser origins are restricted to loopback hosts;
the server itself binds only to `127.0.0.1`.

`stackInput 0` assigns STACK to Input 1, `stackInput 1` assigns it to Input 2,
and `stackInput 2` processes both lanes through independent STACK instances. A lane
not assigned to STACK remains dry, so a tablet can stay clean on Input 1 while a
guitar uses STACK on Input 2. The faceplate exposes these choices directly.

Shared low-period `IAudioClient3` is the default because it can approach exclusive
latency without seizing the device. Exclusive WASAPI and ASIO remain backend options
after the shared-period hardware measurements are known.
