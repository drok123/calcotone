# CALCOTONE Native Engine

Windows-first native audio backend. The React interface remains a control surface;
audio capture, processing, and playback never enter the browser/webview.

## Current milestone

- allocation-free C++ STACK amp/cab DSP core;
- deterministic 90-path native signal test;
- event-driven `IAudioClient3` capture/render host;
- minimum shared-mode engine periods with raw-mode attempt;
- MMCSS `Pro Audio` realtime threads;
- lock-free stereo capture/render queue;
- underrun/overrun and negotiated-buffer telemetry;
- console control protocol for STACK parameters.

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

Shared low-period `IAudioClient3` is the default because it can approach exclusive
latency without seizing the device. Exclusive WASAPI and ASIO remain backend options
after the shared-period hardware measurements are known.
