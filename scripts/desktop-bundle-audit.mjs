import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, join, relative, resolve } from 'node:path';

const root = process.cwd();
const dist = resolve(root, 'dist');
const publicDir = resolve(root, 'public');
const failures = [];

function walk(directory) {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const full = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...walk(full));
    else files.push(full);
  }
  return files;
}

if (!existsSync(dist)) {
  console.error('CALCOTONE desktop bundle audit failed · dist/ does not exist. Run build:desktop first.');
  process.exit(1);
}

const distFiles = walk(dist);
const distNames = new Set(distFiles.map((file) => basename(file)));
const legacyPublicAudioFiles = readdirSync(publicDir, { withFileTypes: true })
  .filter((entry) => entry.isFile() && entry.name.endsWith('.js'))
  .map((entry) => entry.name);

for (const file of legacyPublicAudioFiles) {
  if (distNames.has(file)) failures.push(`legacy public audio payload copied to desktop dist: ${file}`);
}

const jsFiles = distFiles.filter((file) => file.endsWith('.js'));
const browserAudioSignatures = [
  'AudioWorkletNode',
  'audioWorklet.addModule',
  'createMediaStreamSource',
  'getUserMedia',
  'MediaStreamAudioSourceNode',
  'new AudioContext',
  'new webkitAudioContext',
];

for (const file of jsFiles) {
  const source = readFileSync(file, 'utf8');
  for (const signature of browserAudioSignatures) {
    if (source.includes(signature)) {
      failures.push(`${relative(root, file)} still contains browser-audio runtime signature ${JSON.stringify(signature)}`);
    }
  }
}

if (failures.length) {
  console.error(`CALCOTONE desktop bundle audit failed (${failures.length})`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`CALCOTONE desktop bundle audit passed · ${distFiles.length} packaged files inspected, ${legacyPublicAudioFiles.length} legacy public audio files excluded, and no WebAudio runtime signature remains in desktop JavaScript.`);
