import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const source = readFileSync(resolve(process.cwd(), 'src/audio/NativeAudioBridge.ts'), 'utf8');
const failures = [];
const requireText = (needle, label) => { if (!source.includes(needle)) failures.push(`${label}: missing ${JSON.stringify(needle)}`); };
const forbidText = (text, needle, label) => { if (text.includes(needle)) failures.push(`${label}: forbidden ${JSON.stringify(needle)}`); };

for (const token of [
  "const parameterPrefix = 'param '",
  'line.startsWith(parameterPrefix)',
  'const moduleEnd = line.indexOf(',
  'const parameterEnd = line.indexOf(',
  'const separator = line.indexOf(\' \')',
  'STACK_PROFILE_PARAMETERS.has(name)',
  'STACK_PROFILE_SELECTORS.has(name)',
  'this.rememberDesiredState(line)',
  'this.commandQueue.then(() => this.sendCommand(line))',
]) requireText(token, 'Native control parsing contract');

for (const [startNeedle, endNeedle, label] of [
  ['  private rememberDesiredState(', '  private profileReplayLines(', 'Native desired-state parser'],
  ['  private profileReplayLines(', '  public async probe(', 'Native replay parser'],
]) {
  const start = source.indexOf(startNeedle);
  const end = source.indexOf(endNeedle, start);
  if (start < 0 || end < 0) {
    failures.push(`${label}: function boundaries missing`);
    continue;
  }
  const body = source.slice(start, end);
  forbidText(body, '.split(', `${label} array split`);
  forbidText(body, 'RegExp', `${label} regex construction`);
  forbidText(body, 'match(', `${label} regex matching`);
}

if (failures.length) {
  console.error(`Native control audit failed (${failures.length})`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
console.log('Native control audit passed · hot command classification uses prefix/index parsing and preserves serialized profile replay');
