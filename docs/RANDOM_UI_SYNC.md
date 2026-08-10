# Native RANDOM UI synchronization

The Windows native host receives randomized DSP mode and parameter values immediately. React owns the visible controlled dropdown state, so native RANDOM must also drive the same serial `RANDOM_UI_MODULE_EVENT` / completion flow used by the browser path.

This contract keeps the audible DSP state and visible module state together:

- core module mode dropdowns update to the randomized machine/algorithm;
- Stomp, Stack, and Pressure Rail C random controllers participate in the same reveal sequence;
- non-mutate randomization avoids silently choosing the current machine when another eligible choice exists;
- the faceplate geometry remains unchanged;
- Stomp, Stack, and Pressure use the shared high-DPI animated hardware-art renderer so Rail C matches the visual language of the core rack.

`npm run audit:dropdowns` locks these behaviors into the normal diagnostic suite.
