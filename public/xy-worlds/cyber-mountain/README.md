# Cyber Mountain XY world

The XY video compositor expects six related, camera-compatible MP4 loops in this folder:

- `base.mp4` — default/raw landscape
- `cyber.mp4` — cybernetic / circuitry variation
- `storm.mp4` — storm / lightning / atmospheric variation
- `solar.mp4` — warm gold / solar / Ember variation
- `dream.mp4` — fluid / orbital / Drift variation
- `night.mp4` — dark / granular / Artifact-Grain variation

Keep source exposure and contrast baked into the videos. Calcotone only applies restrained hue/saturation/tint grading; it must not animate brightness or contrast.

Recommended source family rules:

- same aspect ratio and camera framing
- same or closely related horizon and terrain silhouette
- loopable motion
- no audio track required
- H.264 MP4 for broad browser support
- matching duration is ideal but not required; the compositor synchronizes normalized playback phase during transitions

The compositor falls back to the procedural Dream Field if the video assets are unavailable, so missing assets never leave the XY pad black.
