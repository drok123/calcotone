from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    target = Path(path)
    text = target.read_text()
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{path}: expected exactly one match, found {count}: {old[:110]!r}")
    target.write_text(text.replace(old, new, 1))


# App.tsx: remove stale type/value imports that the current app no longer uses.
replace_once(
    'src/App.tsx',
    "  type ChangeEvent as ReactChangeEvent,\n  type DragEvent as ReactDragEvent,\n",
    "  type ChangeEvent as ReactChangeEvent,\n",
)
replace_once(
    'src/App.tsx',
    "import { useVisualEngine, type VisualAudioState } from './visual/VisualEngine';",
    "import { useVisualEngine } from './visual/VisualEngine';",
)
replace_once(
    'src/App.tsx',
    "import type { ModuleState, MotionCurve, MotionSmoothing, XYAssignment, XYAxis } from './ui/types';",
    "import type { ModuleState, XYAssignment, XYAxis } from './ui/types';",
)
replace_once(
    'src/App.tsx',
    "import { shapeMotionSource, getEffectiveMotionValue } from './ui/motion';",
    "import { shapeMotionSource } from './ui/motion';",
)

# AudioEngine: remove abandoned profiler locals, use a strict ArrayBuffer-backed curve,
# and keep quality-mode behavior otherwise untouched by this housekeeping pass.
replace_once(
    'src/audio/AudioEngine.ts',
    """    const grain = this.effects.get('bitcrusher');
    const ember = this.effects.get('saturation');
    const drift = this.effects.get('chorus');
    const artifact = this.effects.get('media');
    const grainStats = grain && 'getProfilerStats' in grain
""",
    """    const grain = this.effects.get('bitcrusher');
    const grainStats = grain && 'getProfilerStats' in grain
""",
)
replace_once(
    'src/audio/AudioEngine.ts',
    """    const grain = this.effects.get('bitcrusher');
    const ember = this.effects.get('saturation');
    const drift = this.effects.get('chorus');
    const artifact = this.effects.get('media');
    if (grain && 'setQualityMode' in grain) {
""",
    """    const grain = this.effects.get('bitcrusher');
    if (grain && 'setQualityMode' in grain) {
""",
)
replace_once(
    'src/audio/AudioEngine.ts',
    "function createSafetyCurve(): Float32Array {",
    "function createSafetyCurve(): Float32Array<ArrayBuffer> {",
)

# erasableSyntaxOnly rejects TS parameter properties. Keep the class behavior identical.
replace_once(
    'src/audio/InputMatrix.ts',
    "  private invertRight = false;\n\n  public constructor(private readonly context: AudioContext) {\n",
    "  private invertRight = false;\n  private readonly context: AudioContext;\n\n  public constructor(context: AudioContext) {\n    this.context = context;\n",
)

# Newer DOM typings require WaveShaper curves to be explicitly ArrayBuffer-backed.
replace_once(
    'src/audio/effects/Delay.ts',
    "const PITCH_GRAIN_ENVELOPE = new Float32Array([0, 0.18, 0.72, 1, 0.72, 0.18, 0]);",
    "const PITCH_GRAIN_ENVELOPE: Float32Array<ArrayBuffer> = new Float32Array([0, 0.18, 0.72, 1, 0.72, 0.18, 0]);",
)
replace_once(
    'src/audio/effects/Delay.ts',
    "private lastCharacterCurve: Float32Array | null = null;",
    "private lastCharacterCurve: Float32Array<ArrayBuffer> | null = null;",
)
replace_once(
    'src/audio/effects/Delay.ts',
    "private lastCurve: Float32Array | null = null;",
    "private lastCurve: Float32Array<ArrayBuffer> | null = null;",
)
replace_once(
    'src/audio/effects/Delay.ts',
    "function createEqualPowerFade(fadeIn: boolean): Float32Array {",
    "function createEqualPowerFade(fadeIn: boolean): Float32Array<ArrayBuffer> {",
)
replace_once(
    'src/audio/effects/Delay.ts',
    "const CHARACTER_CURVE_CACHE = new Map<string, Float32Array>();",
    "const CHARACTER_CURVE_CACHE = new Map<string, Float32Array<ArrayBuffer>>();",
)
replace_once(
    'src/audio/effects/Delay.ts',
    "function getCharacterCurve(character: number, config: DelayAlgorithmConfig): Float32Array {",
    "function getCharacterCurve(character: number, config: DelayAlgorithmConfig): Float32Array<ArrayBuffer> {",
)
replace_once(
    'src/audio/effects/Delay.ts',
    "function createCharacterCurve(character: number, config: DelayAlgorithmConfig): Float32Array {",
    "function createCharacterCurve(character: number, config: DelayAlgorithmConfig): Float32Array<ArrayBuffer> {",
)
replace_once(
    'src/audio/effects/Delay.ts',
    "const SPACE_ECHO_CURVE_CACHE = new Map<number, Float32Array>();",
    "const SPACE_ECHO_CURVE_CACHE = new Map<number, Float32Array<ArrayBuffer>>();",
)
replace_once(
    'src/audio/effects/Delay.ts',
    "function getSpaceEchoCurve(age: number): Float32Array {",
    "function getSpaceEchoCurve(age: number): Float32Array<ArrayBuffer> {",
)

replace_once(
    'src/audio/effects/Reverb.ts',
    "function createAtmosFade(fadeIn: boolean): Float32Array {",
    "function createAtmosFade(fadeIn: boolean): Float32Array<ArrayBuffer> {",
)
replace_once(
    'src/audio/effects/Reverb.ts',
    "function createAtmosLoopCurve(): Float32Array {",
    "function createAtmosLoopCurve(): Float32Array<ArrayBuffer> {",
)
replace_once(
    'src/audio/effects/Reverb.ts',
    "function createIdentityCurve(): Float32Array {",
    "function createIdentityCurve(): Float32Array<ArrayBuffer> {",
)
replace_once(
    'src/audio/effects/Reverb.ts',
    "function createConverterCurve(bits: number): Float32Array {",
    "function createConverterCurve(bits: number): Float32Array<ArrayBuffer> {",
)
