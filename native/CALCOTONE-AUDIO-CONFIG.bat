@echo off
rem CALCOTONE native audio configuration. Channel numbers are one-based.
rem Backend: auto probes KS/WaveRT then uses the stable WASAPI stream.
set "CALCOTONE_AUDIO_BACKEND=auto"
rem Revelator exclusive mode negotiates PCM24-in-32. Use shared mode by default
rem so Windows supplies its native mix format and bypasses interface-specific
rem 24-bit container packing while the exclusive converter is validated.
set "CALCOTONE_AUDIO_MODE=shared"
rem Shared mode requests RAW processing first, then retries the complete stream
rem with standard processing if the endpoint or driver rejects RAW.
set "CALCOTONE_SHARED_RAW=1"
rem Use explicit physical Revelator endpoints. The Windows default render device
rem may be Virtual Output A/B, which can route through Universal Control's
rem loopback mixer and create feedback-like buzzing or recycled audio.
set "CALCOTONE_CAPTURE_DEVICE=Mic/Inst 1/2"
set "CALCOTONE_RENDER_DEVICE=Main Out"
set "CALCOTONE_BUFFER_FRAMES=256"
rem Leave sample rate empty to follow the interface's configured rate.
set "CALCOTONE_SAMPLE_RATE="
set "CALCOTONE_INPUT_1_CHANNEL=1"
set "CALCOTONE_INPUT_2_CHANNEL=2"
set "CALCOTONE_OUTPUT_LEFT_CHANNEL=1"
set "CALCOTONE_OUTPUT_RIGHT_CHANNEL=2"
