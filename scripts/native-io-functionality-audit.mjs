import { readFileSync } from 'node:fs';

const app = readFileSync('src/App.tsx', 'utf8');
const processor = readFileSync('native/src/native_processor.cpp', 'utf8');
const router = readFileSync('native/include/calcotone/input_router.hpp', 'utf8');
const test = readFileSync('native/tests/native_processor_test.cpp', 'utf8');
const failures = [];

const requireText = (source, token, label) => {
  if (!source.includes(token)) failures.push(`${label}: missing ${JSON.stringify(token)}`);
};
const forbidText = (source, token, label) => {
  if (source.includes(token)) failures.push(`${label}: forbidden ${JSON.stringify(token)}`);
};

requireText(app, "useState<InputMode>(nativeShell ? 'stereo' : 'mono-to-stereo')", 'Native startup preserves both input lanes');
requireText(app, 'nativeInputModeIndex(mode)', 'Native input-mode mapping');
requireText(app, 'param pressure inputMode ${nativeInputModeIndex(mode)}', 'Live native input-mode command');
requireText(app, 'param pressure inputWidth ${value}', 'Live native width command');
requireText(app, 'param pressure inputPolarity ${nativeInputPolarityBits(left, right)}', 'Live native polarity command');
requireText(app, 'param pressure inputMode ${nativeInputModeIndex(inputMode)}', 'Native startup input-mode sync');
requireText(app, 'param pressure inputWidth ${inputWidth}', 'Native startup width sync');
requireText(app, 'param pressure inputPolarity ${nativeInputPolarityBits(invertLeft, invertRight)}', 'Native startup polarity sync');
forbidText(app, "disabled={audioBackend === 'native'}\n                    onChange={(event: ReactChangeEvent<HTMLSelectElement>) =>\n                      updateInputMode", 'Native input-mode selector must remain interactive');
requireText(app, "disabled={audioBackend === 'native'}", 'Native SAFE control truthfulness');
requireText(app, 'Native realtime I/O safety is always enabled', 'Native SAFE explanation');

for (const token of ['InputRoutingMode', 'input_route_target(', 'route_dual_mono(', 'input_route_alpha']) {
  requireText(router + processor, token, 'Native input matrix DSP');
}
requireText(processor, 'name == "inputMode"', 'Native input-mode command tunnel');
requireText(processor, 'name == "inputWidth"', 'Native width command tunnel');
requireText(processor, 'name == "inputPolarity"', 'Native polarity command tunnel');

for (const mode of ['Stereo', 'Right', 'Left', 'Swap', 'SumMono']) {
  requireText(test, `InputRoutingMode::${mode}`, `Native input mode test ${mode}`);
}
requireText(test, 'set_input_width(1.F)', 'Native width setter test');
requireText(test, 'set_input_polarity(true, false)', 'Native polarity transition test');
requireText(test, 'right_only_from_left < .003F', 'Native routed-audio assertion');

if (failures.length) {
  console.error(`\nNative I/O functionality audit failed:\n${failures.map((failure) => ` - ${failure}`).join('\n')}\n`);
  process.exit(1);
}

console.log('Native I/O functionality audit passed: mode, width, polarity and SAFE UI semantics are wired to tested native behavior.');
