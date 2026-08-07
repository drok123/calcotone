import { readFileSync, writeFileSync } from 'node:fs';

function read(path) { return readFileSync(path, 'utf8'); }
function write(path, value) { writeFileSync(path, value, 'utf8'); }
function replaceOnce(source, search, replacement, label) {
  const next = source.replace(search, replacement);
  if (next === source) throw new Error(`Could not patch ${label}`);
  return next;
}
function replaceSlice(source, startNeedle, endNeedle, replacement, label) {
  const start = source.indexOf(startNeedle);
  const end = source.indexOf(endNeedle, start + startNeedle.length);
  if (start < 0 || end < 0) throw new Error(`Could not locate ${label}`);
  return source.slice(0, start) + replacement + source.slice(end);
}

// ---------------- Rail C: Pressure -> standalone 8-track Loop ----------------
{
  const path = 'src/components/effects/RailCModules.tsx';
  let source = read(path);
  source = replaceOnce(source,
`import {
  SIGNAL_LAB_LABELS,
  SIGNAL_LAB_MODES,
  SIGNAL_LAB_STYLES,
  type SignalLabMode,
  type SignalLabStyle,
} from '../../audio/SignalLab';
`, '', 'retired Pressure imports');
  source = replaceOnce(source,
`import {
  randomizePressure,
  setPressureState,
  usePressureState,
} from '../signal/pressureStore';
`,
`import {
  LOOP_TRACK_COUNT,
  occupiedLoopTracks,
  sendLoopCommand,
  setLoopState,
  setSelectedTrackLevel,
  useLoopState,
} from '../signal/loopStore';
`, 'Loop store imports');
  source = replaceOnce(source, 'draggable={!faceplateEditor.editing}', "draggable={!faceplateEditor.editing && id !== 'pressure'}", 'Loop routing drag lock');
  source = replaceOnce(source, 'tabIndex={faceplateEditor.editing ? -1 : 0}', "tabIndex={faceplateEditor.editing || id === 'pressure' ? -1 : 0}", 'Loop routing tab lock');
  source = replaceOnce(source, 'onDragStart={onRoutingDragStart}', "onDragStart={id !== 'pressure' ? onRoutingDragStart : undefined}", 'Loop routing handler lock');
  source = replaceOnce(source, `          onKeyDown={(event: ReactKeyboardEvent<HTMLDivElement>) => {
            if (event.key === 'ArrowLeft') {`, `          onKeyDown={(event: ReactKeyboardEvent<HTMLDivElement>) => {
            if (id === 'pressure') return;
            if (event.key === 'ArrowLeft') {`, 'Loop routing keyboard lock');
  source = replaceOnce(source, 'title="Drag to any rack slot · or focus and use ← / → within this rail"', "title={id === 'pressure' ? 'LOOP is a standalone post-rack recorder' : 'Drag to any rack slot · or focus and use ← / → within this rail'}", 'Loop routing title');
  source = replaceOnce(source, '<span className="module-route-cue" aria-hidden="true">↔</span>', "<span className=\"module-route-cue\" aria-hidden=\"true\">{id === 'pressure' ? '∞' : '↔'}</span>", 'Loop route cue');
  source = source.replace('aria-label="Pressure operating style"', 'aria-label="Rail C transport controls"');
  source = source.replace("title={editor.editing ? 'Move Pressure style button independently' : undefined}", "title={editor.editing ? 'Move Rail C button independently' : undefined}");

  const loopModule = `function LoopModule({
  running,
  visualState,
  ...props
}: RailInteractionProps & {
  running: boolean;
  visualState: VisualAudioState;
}) {
  const state = useLoopState();
  const trackLevel = state.trackLevels[state.selectedTrack] ?? 0.72;
  const occupied = occupiedLoopTracks(state.trackMask);
  const seconds = state.loopFrames > 0 ? state.loopFrames / Math.max(1, state.sampleRate) : 0;
  const selectedFilled = (state.trackMask & (1 << state.selectedTrack)) !== 0;
  const knobLabels = ['Track', 'Loop', 'Overdub', 'Fade'] as const;
  const knobValues = [trackLevel, state.masterLevel, state.overdub, state.fade] as const;

  function setKnob(index: number, value: number): void {
    if (index === 0) setSelectedTrackLevel(value);
    else if (index === 1) setLoopState({ masterLevel: value });
    else if (index === 2) setLoopState({ overdub: value });
    else setLoopState({ fade: value });
  }

  function resetKnob(index: number): void {
    if (index === 0) setSelectedTrackLevel(0.72);
    else if (index === 1) setLoopState({ masterLevel: 0.78 });
    else if (index === 2) setLoopState({ overdub: 1 });
    else setLoopState({ fade: 0.18 });
  }

  return (
    <RailModuleFrame
      {...props}
      id="pressure"
      name="Loop"
      enabled={state.enabled}
      onToggle={() => setLoopState({ enabled: !state.enabled })}
      headerControl={(
        <label className="algorithm-selector pressure-machine-selector">
          <span className="sr-only">Loop track</span>
          <select aria-label="Loop track" value={state.selectedTrack} onChange={(event) => setLoopState({ selectedTrack: Number(event.target.value) })}>
            {Array.from({ length: LOOP_TRACK_COUNT }, (_, index) => (
              <option value={index} key={index}>{\`T\${index + 1}\${(state.trackMask & (1 << index)) !== 0 ? ' ●' : ''}\`}</option>
            ))}
          </select>
        </label>
      )}
    >
      <RailCFaceplateSurface
        moduleId="pressure"
        knobRowClass="pressure-rail-knobs"
        viewport={(
          <div className={\`pressure-ascii dsp-viewport \${state.enabled ? 'active' : 'is-off'}\`} aria-label="Loop memory transport display">
            <RailCHardwareDisplay
              kind="loop"
              enabled={state.enabled}
              visualState={visualState}
              modeLabel={state.transport}
              detailLabel={\`T\${state.selectedTrack + 1} \u00b7 \${selectedFilled ? 'MEM' : 'EMPTY'} \u00b7 \${occupied}/8 \u00b7 \${seconds.toFixed(1)}s \u00b7 \${running ? 'LIVE' : 'READY'}\`}
            />
          </div>
        )}
        knobs={knobLabels.map((label, index) => (
          <Knob
            key={label}
            label={label}
            value={knobValues[index]}
            effectiveValue={knobValues[index]}
            display={index === 3 ? \`\${Math.round(knobValues[index] * 20)} ms\` : \`\${Math.round(knobValues[index] * 100)}%\`}
            patchTarget={\`pressure.loop-\${index}\`}
            onChange={(value) => setKnob(index, value)}
            onReset={() => resetKnob(index)}
            onPatchStart={() => undefined}
            onPatchMove={() => undefined}
            onPatchEnd={() => undefined}
            onPatchDisconnect={() => undefined}
          />
        ))}
        buttons={([
          ['REC', 'record'],
          ['DUB', 'overdub'],
          ['PLAY', 'play'],
          ['CLEAR', 'clear'],
        ] as const).map(([label, command]) => {
          const active = command === 'record' ? state.transport === 'recording'
            : command === 'overdub' ? state.transport === 'overdubbing'
            : command === 'play' ? state.transport === 'playing'
            : false;
          return (
            <button type="button" key={command} className={active ? 'active' : ''} aria-pressed={active} onClick={() => sendLoopCommand(command)}>
              {label}
            </button>
          );
        })}
      />
    </RailModuleFrame>
  );
}

`;
  source = replaceSlice(source, 'function PressureModule(', '\nexport function RailCModule', loopModule, 'Pressure module body');
  source = replaceOnce(source, `  if (moduleId === 'pressure') return <PressureModule {...interaction} running={running} visualState={visualState} />;`, `  if (moduleId === 'pressure') return <LoopModule {...interaction} running={running} visualState={visualState} />;`, 'Loop module dispatch');
  source = replaceOnce(source, 'export const STOMP_MODE_LABELS = [', `export const LOOP_TRACK_MODES = ['loop'] as const;\n\nexport const STOMP_MODE_LABELS = [`, 'Loop contract symbol');
  write(path, source);
}

// ---------------- App native Loop synchronization ----------------
{
  const path = 'src/App.tsx';
  let source = read(path);
  source = replaceOnce(source,
`import { SIGNAL_LAB_MODES, SIGNAL_LAB_STYLES, type SignalLabState } from './audio/SignalLab';
import { getPressureState } from './components/signal/pressureStore';
`,
`import {
  getLoopState,
  setLoopRuntime,
  LOOP_CHANGE_EVENT,
  LOOP_COMMAND_EVENT,
  type LoopCommand,
  type LoopSettings,
} from './components/signal/loopStore';
`, 'App Loop imports');
  source = replaceOnce(source,
`const RAIL_C_MODULE_NAMES: Record<RailCRandomModuleId, string> = {
  stomp: 'Stomp',
  chaos: 'Stack',
  pressure: 'Pressure',
};`,
`const RAIL_C_MODULE_NAMES: Record<RailCRandomModuleId, string> = {
  stomp: 'Stomp',
  chaos: 'Stack',
};`, 'Rail C random names');
  source = replaceOnce(source,
`        setNativeTuner({ hz: health.tunerHz || 0, level: health.tunerLevel || 0 });
        setNativeHealth(health);`,
`        setNativeTuner({ hz: health.tunerHz || 0, level: health.tunerLevel || 0 });
        setNativeHealth(health);
        const loopTransports = ['empty', 'stopped', 'playing', 'recording', 'overdubbing'] as const;
        setLoopRuntime({
          transport: loopTransports[health.loopTransport ?? 0] ?? 'empty',
          trackMask: health.loopTrackMask ?? 0,
          loopFrames: health.loopFrames ?? 0,
          position: health.loopPosition ?? 0,
          sampleRate: health.sampleRate,
        });`, 'native Loop runtime health');

  const loopSync = `  useEffect(() => {
    const sendSettings = (settings: LoopSettings): void => {
      if (backendRef.current !== 'native') return;
      const bridge = nativeBridgeRef.current;
      void bridge.commandLine(\`loopParam enabled \${settings.enabled ? 1 : 0}\`);
      void bridge.commandLine(\`loopParam track \${settings.selectedTrack}\`);
      void bridge.commandLine(\`loopParam masterLevel \${settings.masterLevel}\`);
      void bridge.commandLine(\`loopParam overdub \${settings.overdub}\`);
      void bridge.commandLine(\`loopParam fade \${settings.fade}\`);
      settings.trackLevels.forEach((level, index) => void bridge.commandLine(\`loopTrackLevel \${index} \${level}\`));
    };
    const syncNativeLoop = (event: Event): void => sendSettings((event as CustomEvent<LoopSettings>).detail ?? getLoopState());
    const syncNativeLoopCommand = (event: Event): void => {
      if (backendRef.current !== 'native') return;
      const command = (event as CustomEvent<LoopCommand>).detail;
      if (command) void nativeBridgeRef.current.commandLine(\`loop \${command}\`);
    };
    window.addEventListener(LOOP_CHANGE_EVENT, syncNativeLoop);
    window.addEventListener(LOOP_COMMAND_EVENT, syncNativeLoopCommand);
    return () => {
      window.removeEventListener(LOOP_CHANGE_EVENT, syncNativeLoop);
      window.removeEventListener(LOOP_COMMAND_EVENT, syncNativeLoopCommand);
    };
  }, []);
`;
  source = replaceSlice(source, `  useEffect(() => {\n    const syncNativePressure`, `  const [recordingState`, `${loopSync}  const [recordingState`, 'native Pressure sync effect');

  source = replaceOnce(source,
`        const pressure = getPressureState();
        nativeSync.push(nativeBridgeRef.current.commandLine(\`moduleBypass pressure \${pressure.enabled ? 0 : 1}\`));
        nativeSync.push(nativeBridgeRef.current.commandLine(\`param pressure mode \${SIGNAL_LAB_MODES.indexOf(pressure.mode)}\`));
        nativeSync.push(nativeBridgeRef.current.commandLine(\`param pressure style \${SIGNAL_LAB_STYLES.indexOf(pressure.style)}\`));
        for (const key of ['drive', 'time', 'character', 'mix'] as const)
          nativeSync.push(nativeBridgeRef.current.commandLine(\`param pressure \${key} \${pressure[key]}\`));`,
`        const loop = getLoopState();
        nativeSync.push(nativeBridgeRef.current.commandLine(\`loopParam enabled \${loop.enabled ? 1 : 0}\`));
        nativeSync.push(nativeBridgeRef.current.commandLine(\`loopParam track \${loop.selectedTrack}\`));
        nativeSync.push(nativeBridgeRef.current.commandLine(\`loopParam masterLevel \${loop.masterLevel}\`));
        nativeSync.push(nativeBridgeRef.current.commandLine(\`loopParam overdub \${loop.overdub}\`));
        nativeSync.push(nativeBridgeRef.current.commandLine(\`loopParam fade \${loop.fade}\`));
        loop.trackLevels.forEach((level, index) => nativeSync.push(nativeBridgeRef.current.commandLine(\`loopTrackLevel \${index} \${level}\`)));`, 'native Loop startup sync');
  write(path, source);
}

// ---------------- Artifact: absorb old Pressure compressor hardware ----------------
{
  const path = 'src/audio/effects/Media.ts';
  let source = read(path);
  source = replaceOnce(source, `import { BaseEffect } from './Effect';`, `import { BaseEffect } from './Effect';\nimport { SignalLab, SIGNAL_LAB_STYLES, type SignalLabMode } from '../SignalLab';`, 'Artifact dynamics import');
  source = replaceOnce(source, `  | 'Ampex ATR-102'\n  | 'Neve BCM10';`, `  | 'Ampex ATR-102'\n  | 'Neve BCM10'\n  | 'compressor-fet'\n  | 'compressor-opto'\n  | 'compressor-varimu'\n  | 'compressor-vca';`, 'Artifact dynamics mode type');
  source = replaceOnce(source, `export const ARTIFACT_CONSOLE_MODES = [`, `export const ARTIFACT_DYNAMICS_MODES = [\n  'compressor-fet','compressor-opto','compressor-varimu','compressor-vca',\n] as const satisfies readonly MediaMode[];\n\nexport const ARTIFACT_CONSOLE_MODES = [`, 'Artifact dynamics mode group');
  source = replaceOnce(source,
`  'tascam424','Neve 1073','SSL 4000E','API 1608','Ampex ATR-102','Neve BCM10',
];`,
`  'tascam424','Neve 1073','SSL 4000E','API 1608','Ampex ATR-102','Neve BCM10',
  ...ARTIFACT_DYNAMICS_MODES,
];`, 'Artifact dynamics order');
  source = replaceOnce(source,
`  { label: 'TAPE MACHINES', modes: ['Ampex ATR-102'] },
]`,
`  { label: 'TAPE MACHINES', modes: ['Ampex ATR-102'] },
  { label: 'DYNAMICS', modes: ARTIFACT_DYNAMICS_MODES },
]`, 'Artifact dynamics dropdown group');
  source = replaceOnce(source, `  private readonly mediaGain: GainNode;`, `  private readonly mediaGain: GainNode;\n  private readonly dynamics: SignalLab;\n  private readonly dynamicsGain: GainNode;`, 'Artifact dynamics members');
  source = replaceOnce(source, `    this.mediaGain = context.createGain();`, `    this.mediaGain = context.createGain();\n    this.dynamics = new SignalLab(context);\n    this.dynamicsGain = context.createGain();`, 'Artifact dynamics construction');
  source = replaceOnce(source, `    this.mediaGain.gain.value = 1;`, `    this.mediaGain.gain.value = 1;\n    this.dynamicsGain.gain.value = 0;`, 'Artifact dynamics initial gain');
  source = replaceOnce(source, `    this.mediaGain.connect(this.wetGain);`, `    this.mediaGain.connect(this.wetGain);\n    this.input.connect(this.dynamics.input);\n    this.dynamics.connect(this.dynamicsGain);\n    this.dynamicsGain.connect(this.wetGain);`, 'Artifact dynamics routing');
  source = replaceOnce(source, `    this.tascamPreamp.dispose();\n    this.tascamChannel.dispose();`, `    this.tascamPreamp.dispose();\n    this.tascamChannel.dispose();\n    this.dynamics.dispose();`, 'Artifact dynamics disposal');
  source = replaceOnce(source, `      this.cassetteNoiseGain, this.vinylNoiseGain, this.mediaGain,`, `      this.cassetteNoiseGain, this.vinylNoiseGain, this.mediaGain, this.dynamicsGain,`, 'Artifact dynamics gain disposal');
  source = replaceOnce(source,
`    this.mediaGain.gain.setTargetAtTime(1, now, 0.025);
    this.setTransportAttached(!ARTIFACT_CONSOLE_MODES.some((mode) => mode === this.mode));`,
`    this.mediaGain.gain.setTargetAtTime(1, now, 0.025);
    const dynamicsMode = artifactDynamicsMode(this.mode);
    if (dynamicsMode) {
      this.setTransportAttached(false);
      this.disableTransport(now);
      this.setCrossfeed(0, now);
      this.mediaGain.gain.setTargetAtTime(0, now, 0.018);
      this.dynamicsGain.gain.setTargetAtTime(1, now, 0.018);
      this.dynamics.setState({
        enabled: true,
        mode: dynamicsMode,
        style: SIGNAL_LAB_STYLES[Math.min(SIGNAL_LAB_STYLES.length - 1, Math.floor(this.noise * SIGNAL_LAB_STYLES.length))]!,
        drive: this.wear,
        time: this.wow,
        character: this.tone,
        mix: 1,
      });
      return;
    }
    this.dynamics.setState({ enabled: false });
    this.dynamicsGain.gain.setTargetAtTime(0, now, 0.018);
    this.setTransportAttached(!ARTIFACT_CONSOLE_MODES.some((mode) => mode === this.mode));`, 'Artifact dynamics branch');
  source = replaceOnce(source,
`function isInsertMode(mode: MediaMode): boolean {
  return mode === 'Ampex ATR-102' || ARTIFACT_CONSOLE_MODES.some((candidate) => candidate === mode);
}`,
`function artifactDynamicsMode(mode: MediaMode): SignalLabMode | null {
  if (mode === 'compressor-fet') return 'fet';
  if (mode === 'compressor-opto') return 'opto';
  if (mode === 'compressor-varimu') return 'varimu';
  if (mode === 'compressor-vca') return 'vca';
  return null;
}

function isInsertMode(mode: MediaMode): boolean {
  return mode === 'Ampex ATR-102'
    || ARTIFACT_CONSOLE_MODES.some((candidate) => candidate === mode)
    || ARTIFACT_DYNAMICS_MODES.some((candidate) => candidate === mode);
}`, 'Artifact insert mode helper');
  write(path, source);
}

{
  const path = 'src/components/effects/EffectModule.tsx';
  let source = read(path);
  source = replaceOnce(source, `import { ARTIFACT_CONSOLE_MODES, MEDIA_MODE_GROUPS, type MediaMode } from '../../audio/effects/Media';`, `import { ARTIFACT_CONSOLE_MODES, ARTIFACT_DYNAMICS_MODES, MEDIA_MODE_GROUPS, type MediaMode } from '../../audio/effects/Media';`, 'Artifact dynamics UI import');
  source = replaceOnce(source,
`function formatMediaMode(mode: MediaMode): string {
  if (mode === 'tascam424') return 'TASCAM 424 MKI';
  return mode.charAt(0).toUpperCase() + mode.slice(1);
}`,
`function formatMediaMode(mode: MediaMode): string {
  if (mode === 'tascam424') return 'TASCAM 424 MKI';
  if (mode === 'compressor-fet') return 'FET 76';
  if (mode === 'compressor-opto') return 'OPTO 2A';
  if (mode === 'compressor-varimu') return 'VARI-MU';
  if (mode === 'compressor-vca') return 'VCA BUS';
  return mode.charAt(0).toUpperCase() + mode.slice(1);
}`, 'Artifact dynamics labels');
  source = replaceOnce(source,
`  if (module.id === 'media' && module.mediaMode && ARTIFACT_CONSOLE_MODES.some((mode) => mode === module.mediaMode)) {`,
`  if (module.id === 'media' && module.mediaMode && ARTIFACT_DYNAMICS_MODES.some((mode) => mode === module.mediaMode)) {
    if (parameterId === 'wear') return { label: 'Drive', display };
    if (parameterId === 'wow') return { label: 'Time', display };
    if (parameterId === 'noise') {
      const styles = ['SOFT', 'PUNCH', 'GLUE', 'CRUSH'];
      return { label: 'Style', display: styles[Math.min(3, Math.floor(value * 4))] ?? 'GLUE' };
    }
    if (parameterId === 'tone') return { label: 'Character', display };
    if (parameterId === 'mix') return { label: 'Mix', display };
  }

  if (module.id === 'media' && module.mediaMode && ARTIFACT_CONSOLE_MODES.some((mode) => mode === module.mediaMode)) {`, 'Artifact dynamics knob presentation');
  write(path, source);
}

// ---------------- Native Artifact compressor reuse ----------------
{
  const path = 'native/src/artifact_parity_processor.cpp';
  let source = read(path);
  source = replaceOnce(source, `#include "calcotone/artifact_parity_processor.hpp"`, `#include "calcotone/artifact_parity_processor.hpp"\n#include "calcotone/pressure_parity_processor.hpp"`, 'native Artifact dynamics include');
  source = replaceOnce(source,
`  explicit Impl(float requested_rate)
      : rate(std::clamp(requested_rate, 8'000.F, 384'000.F)) {`,
`  explicit Impl(float requested_rate)
      : rate(std::clamp(requested_rate, 8'000.F, 384'000.F)), dynamics(rate) {`, 'native Artifact dynamics construction');
  source = replaceOnce(source, `    active_mode = -1;\n    update_point();`, `    active_mode = -1;\n    dynamics.reset();\n    update_point();`, 'native Artifact dynamics reset');
  source = replaceOnce(source,
`  void process(float* data, std::size_t frames) noexcept {
    const float character_smoothing`,
`  void process(float* data, std::size_t frames) noexcept {
    const unsigned requested_mode = std::min(17U, static_cast<unsigned>(std::max(0.F, std::round(target[0].load(std::memory_order_relaxed)))));
    if (requested_mode >= 14U) {
      dynamics.set_bypassed(false);
      dynamics.set_parameter("mode", static_cast<float>(requested_mode - 14U));
      dynamics.set_parameter("style", std::round(clamp01(target[3].load(std::memory_order_relaxed)) * 3.F));
      dynamics.set_parameter("drive", clamp01(target[1].load(std::memory_order_relaxed)));
      dynamics.set_parameter("time", clamp01(target[2].load(std::memory_order_relaxed)));
      dynamics.set_parameter("character", clamp01(target[4].load(std::memory_order_relaxed)));
      dynamics.set_parameter("mix", clamp01(target[5].load(std::memory_order_relaxed)));
      dynamics.process(data, frames);
      return;
    }
    const float character_smoothing`, 'native Artifact dynamics process');
  source = replaceOnce(source, `  float rate;\n  std::array<std::vector<float>, 2> transport;`, `  float rate;\n  PressureParityProcessor dynamics;\n  std::array<std::vector<float>, 2> transport;`, 'native Artifact dynamics member');
  source = replaceOnce(source, `if (index == 0U) value = std::clamp(std::round(value), 0.F, 13.F);`, `if (index == 0U) value = std::clamp(std::round(value), 0.F, 17.F);`, 'native Artifact mode range');
  write(path, source);
}

// ---------------- Native processor: post-rack Loop sidecar ----------------
{
  const headerPath = 'native/include/calcotone/native_processor.hpp';
  let header = read(headerPath);
  header = replaceOnce(header, `#include "calcotone/native_rack.hpp"`, `#include "calcotone/native_rack.hpp"\n#include "calcotone/loop_processor.hpp"`, 'native Loop processor include');
  header = replaceOnce(header, `  void set_pressure_bypassed(bool bypassed) noexcept;`, `  void set_pressure_bypassed(bool bypassed) noexcept;\n  void set_loop_enabled(bool enabled) noexcept;\n  void set_loop_selected_track(unsigned track) noexcept;\n  void set_loop_master_level(float value) noexcept;\n  void set_loop_track_level(unsigned track, float value) noexcept;\n  void set_loop_overdub(float value) noexcept;\n  void set_loop_fade(float value) noexcept;\n  void loop_command(LoopCommand command) noexcept;\n  LoopTransport loop_transport() const noexcept;\n  unsigned loop_selected_track() const noexcept;\n  std::uint32_t loop_track_mask() const noexcept;\n  std::uint64_t loop_frames() const noexcept;\n  std::uint64_t loop_position() const noexcept;`, 'native Loop API');
  write(headerPath, header);

  const path = 'native/src/native_processor.cpp';
  let source = read(path);
  source = replaceOnce(source,
`        stack_one(rate), stack_two(rate), rack_one(rate), rack_two(rate),
        pressure_one(rate), pressure_two(rate), dream(rate, kBlockFrames) {`,
`        stack_one(rate), stack_two(rate), rack_one(rate), rack_two(rate),
        pressure_one(rate), pressure_two(rate), loop(rate), dream(rate, kBlockFrames) {`, 'native Loop construction');
  source = replaceOnce(source,
`    pressure_one.process(lane_one_output.data(), frames);
    pressure_two.process(lane_two_output.data(), frames);
    const bool pressure_active = !pressure_bypassed.load(std::memory_order_relaxed);
    dream.finish_block(lane_one_output.data(), lane_two_output.data(), frames,
                       any_rack_active || !stack_off || pressure_active);
    const float gain = active.load(std::memory_order_relaxed)
        ? output_gain.load(std::memory_order_relaxed) : 0.F;
    std::uint64_t limited = 0;
    float peak = 0.F;
    mix_dual_mono(lane_one_output.data(), lane_two_output.data(), output, frames, gain, &limited, &peak);`,
`    dream.finish_block(lane_one_output.data(), lane_two_output.data(), frames,
                       any_rack_active || !stack_off);
    const bool host_active = active.load(std::memory_order_relaxed);
    sum_dual_mono(lane_one_output.data(), lane_two_output.data(), output, frames);
    if (host_active) loop.process(output, frames);
    const float gain = host_active ? output_gain.load(std::memory_order_relaxed) : 0.F;
    std::uint64_t limited = 0;
    float peak = 0.F;
    apply_output_safety(output, frames, gain, &limited, &peak);`, 'native post-rack Loop path');
  source = replaceOnce(source, `  NativePressure pressure_one, pressure_two;\n  NativeDreamEngine dream;`, `  NativePressure pressure_one, pressure_two;\n  LoopProcessor loop;\n  NativeDreamEngine dream;`, 'native Loop member');
  source = replaceOnce(source,
`void NativeProcessor::set_pressure_bypassed(bool bypassed) noexcept {
  impl_->pressure_bypassed.store(bypassed, std::memory_order_relaxed);
  impl_->pressure_one.set_bypassed(bypassed); impl_->pressure_two.set_bypassed(bypassed);
}`,
`void NativeProcessor::set_pressure_bypassed(bool bypassed) noexcept {
  impl_->pressure_bypassed.store(bypassed, std::memory_order_relaxed);
  impl_->pressure_one.set_bypassed(bypassed); impl_->pressure_two.set_bypassed(bypassed);
}
void NativeProcessor::set_loop_enabled(bool value) noexcept { impl_->loop.set_enabled(value); }
void NativeProcessor::set_loop_selected_track(unsigned track) noexcept { impl_->loop.set_selected_track(track); }
void NativeProcessor::set_loop_master_level(float value) noexcept { impl_->loop.set_master_level(value); }
void NativeProcessor::set_loop_track_level(unsigned track, float value) noexcept { impl_->loop.set_track_level(track, value); }
void NativeProcessor::set_loop_overdub(float value) noexcept { impl_->loop.set_overdub(value); }
void NativeProcessor::set_loop_fade(float value) noexcept { impl_->loop.set_fade(value); }
void NativeProcessor::loop_command(LoopCommand command) noexcept { impl_->loop.command(command); }
LoopTransport NativeProcessor::loop_transport() const noexcept { return impl_->loop.transport(); }
unsigned NativeProcessor::loop_selected_track() const noexcept { return impl_->loop.selected_track(); }
std::uint32_t NativeProcessor::loop_track_mask() const noexcept { return impl_->loop.track_mask(); }
std::uint64_t NativeProcessor::loop_frames() const noexcept { return impl_->loop.loop_frames(); }
std::uint64_t NativeProcessor::loop_position() const noexcept { return impl_->loop.position(); }`, 'native Loop method implementations');
  write(path, source);
}

// ---------------- Native host commands / health ----------------
{
  const path = 'native/src/wasapi_host.cpp';
  let source = read(path);
  source = replaceOnce(source,
`               << ",\\\"recordingPeak\\\":" << recorder.peak()
               << ",\\\"tunerHz\\\":" << processor.tuner_frequency()`,
`               << ",\\\"recordingPeak\\\":" << recorder.peak()
               << ",\\\"loopTransport\\\":" << static_cast<unsigned>(processor.loop_transport())
               << ",\\\"loopTrack\\\":" << processor.loop_selected_track()
               << ",\\\"loopTrackMask\\\":" << processor.loop_track_mask()
               << ",\\\"loopFrames\\\":" << processor.loop_frames()
               << ",\\\"loopPosition\\\":" << processor.loop_position()
               << ",\\\"tunerHz\\\":" << processor.tuner_frequency()`, 'native Loop health');
  source = replaceOnce(source,
`      if (name == "recordCancel") { recorder.cancel(); return R"({\\"ok\\":true,\\"command\\":\\"recordCancel\\"})"; }
      if (name == "param") {`,
`      if (name == "recordCancel") { recorder.cancel(); return R"({\\"ok\\":true,\\"command\\":\\"recordCancel\\"})"; }
      if (name == "loop") {
        std::string action; command >> action;
        if (!command) return R"({\\"error\\":\\"expected loop record|overdub|play|clear\\"})";
        if (action == "record") processor.loop_command(calcotone::LoopCommand::Record);
        else if (action == "overdub") processor.loop_command(calcotone::LoopCommand::Overdub);
        else if (action == "play") processor.loop_command(calcotone::LoopCommand::Play);
        else if (action == "clear") processor.loop_command(calcotone::LoopCommand::Clear);
        else return R"({\\"error\\":\\"unknown loop command\\"})";
        return R"({\\"ok\\":true,\\"command\\":\\"loop\\"})";
      }
      if (name == "loopParam") {
        std::string parameter; float value = 0.F; command >> parameter >> value;
        if (!command || !std::isfinite(value)) return R"({\\"error\\":\\"expected loopParam parameter value\\"})";
        if (parameter == "enabled") processor.set_loop_enabled(value >= .5F);
        else if (parameter == "track") processor.set_loop_selected_track(static_cast<unsigned>(std::max(0.F, value)));
        else if (parameter == "masterLevel") processor.set_loop_master_level(value);
        else if (parameter == "overdub") processor.set_loop_overdub(value);
        else if (parameter == "fade") processor.set_loop_fade(value);
        else return R"({\\"error\\":\\"unknown loop parameter\\"})";
        return R"({\\"ok\\":true,\\"command\\":\\"loopParam\\"})";
      }
      if (name == "loopTrackLevel") {
        unsigned track = 0U; float value = 0.F; command >> track >> value;
        if (!command || !std::isfinite(value) || track >= calcotone::kLoopTrackCount) return R"({\\"error\\":\\"expected loopTrackLevel track value\\"})";
        processor.set_loop_track_level(track, value);
        return R"({\\"ok\\":true,\\"command\\":\\"loopTrackLevel\\"})";
      }
      if (name == "param") {`, 'native Loop commands');
  write(path, source);
}

// ---------------- Native build registration ----------------
{
  const path = 'native/CMakeLists.txt';
  let source = read(path);
  source = replaceOnce(source, `  src/pressure_parity_processor.cpp\n`, `  src/pressure_parity_processor.cpp\n  src/loop_processor.cpp\n`, 'Loop native source');
  source = replaceOnce(source, `add_executable(native_processor_test tests/native_processor_test.cpp)\ntarget_link_libraries(native_processor_test PRIVATE calcotone_dsp)`, `add_executable(native_processor_test tests/native_processor_test.cpp)\ntarget_link_libraries(native_processor_test PRIVATE calcotone_dsp)\nadd_executable(loop_processor_test tests/loop_processor_test.cpp)\ntarget_link_libraries(loop_processor_test PRIVATE calcotone_dsp)`, 'Loop native test target');
  source = replaceOnce(source, `add_test(NAME native_processor_test COMMAND native_processor_test)`, `add_test(NAME native_processor_test COMMAND native_processor_test)\nadd_test(NAME loop_processor_test COMMAND loop_processor_test)`, 'Loop native ctest');
  write(path, source);
}

// ---------------- Manifest: visible Loop + Artifact dynamics ----------------
{
  const path = 'contracts/calcotone-core-manifest.json';
  const manifest = JSON.parse(read(path));
  const artifact = manifest.modules.find((module) => module.id === 'media');
  if (!artifact) throw new Error('Artifact missing from manifest');
  for (const mode of ['compressor-fet', 'compressor-opto', 'compressor-varimu', 'compressor-vca']) if (!artifact.models.includes(mode)) artifact.models.push(mode);
  const loop = manifest.modules.find((module) => module.id === 'pressure');
  if (!loop) throw new Error('Legacy pressure layout module missing from manifest');
  loop.name = 'Loop';
  loop.defaultModel = 'loop';
  loop.modelOrderSymbol = 'LOOP_TRACK_MODES';
  loop.models = ['loop'];
  loop.controls = [
    { id: 'track', defaultUi: 0 },
    { id: 'masterLevel', defaultUi: 0.78 },
    { id: 'overdub', defaultUi: 1 },
    { id: 'fade', defaultUi: 0.18 },
  ];
  write(path, `${JSON.stringify(manifest, null, 2)}\n`);
}

// ---------------- Audits: lock the new contract ----------------
{
  const path = 'scripts/visual-audit.mjs';
  let source = read(path);
  source = source.replace("requireText(railC, 'kind=\"pressure\"', 'Pressure shared hardware artwork');", "requireText(railC, 'kind=\"loop\"', 'Loop shared hardware artwork');");
  source = source.replace("requireText(railC, 'pressure-ascii dsp-viewport', 'Pressure conventional ASCII display');", "requireText(railC, 'pressure-ascii dsp-viewport', 'Loop approved-geometry ASCII display');");
  source = source.replace("requireText(main, \"import './pressureBridge'\", 'Existing Pressure DSP bridge preserved');", "requireText(main, \"import './loopBridge'\", 'Standalone Loop bridge installed');\nforbidText(main, \"import './pressureBridge'\", 'Retired Pressure post-rack bridge');");
  source = source.replace("console.log('CALCOTONE visual audit passed (six ASCII effects plus Stomp, Stack, and Pressure).');", "console.log('CALCOTONE visual audit passed (six ASCII effects plus Stomp, Stack, and Loop).');");
  source = source.replace('// Rail C is definitively Stomp → Stack → Pressure.', '// Rail C is definitively Stomp → Stack → Loop (legacy layout key pressure).');
  write(path, source);
}

// Dedicated guard for the architectural rules that matter most here.
write('scripts/loop-audit.mjs', `import { readFileSync } from 'node:fs';
const files = Object.fromEntries(['src/components/effects/RailCModules.tsx','src/features/random/railCRandomRegistry.ts','src/routing/serialRouting.ts','src/loopBridge.tsx','src/audio/effects/Media.ts','native/src/native_processor.cpp','native/src/loop_processor.cpp'].map((p)=>[p,readFileSync(p,'utf8')]));
const failures=[];
const need=(p,s,m)=>{if(!files[p].includes(s)) failures.push(m)};
const forbid=(p,s,m)=>{if(files[p].includes(s)) failures.push(m)};
need('src/components/effects/RailCModules.tsx','name="Loop"','Loop visible module name missing');
need('src/components/effects/RailCModules.tsx','kind="loop"','Loop ASCII hardware art missing');
need('src/components/effects/RailCModules.tsx','REC','Loop REC control missing');
need('src/components/effects/RailCModules.tsx','DUB','Loop DUB control missing');
need('src/components/effects/RailCModules.tsx','CLEAR','Loop CLEAR control missing');
need('src/features/random/railCRandomRegistry.ts',"['stomp', 'chaos']",'Loop must be excluded from RANDOM');
forbid('src/features/random/railCRandomRegistry.ts',"'pressure']",'Loop leaked into RANDOM order');
need('src/routing/serialRouting.ts',"LOOP_MODULE_ID = 'pressure'",'Loop compatibility layout key missing');
need('src/routing/serialRouting.ts','sourceId === LOOP_MODULE_ID','Loop must be routing-locked');
need('src/loopBridge.tsx','graph.output.connect(loop.input)','Browser Loop is not post-rack');
need('native/src/native_processor.cpp','sum_dual_mono','Native Loop capture is not post-rack');
need('native/src/native_processor.cpp','loop.process(output, frames)','Native Loop return missing');
need('src/audio/effects/Media.ts','compressor-fet','FET compressor not moved to Artifact');
need('src/audio/effects/Media.ts','compressor-opto','Opto compressor not moved to Artifact');
need('src/audio/effects/Media.ts','compressor-varimu','Vari-Mu compressor not moved to Artifact');
need('src/audio/effects/Media.ts','compressor-vca','VCA compressor not moved to Artifact');
need('native/src/loop_processor.cpp','kLoopTrackCount','Native eight-track loop contract missing');
if(failures.length){console.error('CALCOTONE Loop audit failed:\\n - '+failures.join('\\n - '));process.exit(1)}
console.log('CALCOTONE Loop audit passed (8 tracks, standalone post-rack, RANDOM-safe, Artifact dynamics moved).');
`);

console.log('Applied full CALCOTONE Loop + Artifact dynamics integration.');
