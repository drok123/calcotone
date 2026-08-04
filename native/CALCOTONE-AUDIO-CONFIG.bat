@echo off
rem CALCOTONE native audio configuration. Channel numbers are one-based.
rem Backend: auto probes KS/WaveRT then uses the stable WASAPI stream.
set "CALCOTONE_AUDIO_BACKEND=auto"
set "CALCOTONE_AUDIO_MODE=exclusive"
set "CALCOTONE_CAPTURE_DEVICE=default"
set "CALCOTONE_RENDER_DEVICE=default"
set "CALCOTONE_BUFFER_FRAMES=64"
rem Leave sample rate empty to follow the interface's configured rate.
set "CALCOTONE_SAMPLE_RATE="
set "CALCOTONE_INPUT_1_CHANNEL=1"
set "CALCOTONE_INPUT_2_CHANNEL=2"
set "CALCOTONE_OUTPUT_LEFT_CHANNEL=1"
set "CALCOTONE_OUTPUT_RIGHT_CHANNEL=2"
