import fs from 'node:fs';

const path = 'scripts/windows-ui-parity-audit.mjs';
let source = fs.readFileSync(path, 'utf8');

const pattern = /check\(\(railC\.match\(\/\'\[\^\'\]\+\'\/g\) \?\? \[\]\)\.filter\(\(token\) => \[[\s\S]*?\)\.length === 14, 'stomp', 'fourteen stable Stomp UI labels'\);/;
const expectedBlock = `export const STOMP_MODE_LABELS = [
  '808 Overdrive', 'RAT Distortion', 'Big Muff', 'Fuzz Face', 'DS-1 Distortion',
  'Blues Driver', 'Gold Horse', 'Swedish Chainsaw', 'Metal Zone', 'Octavia',
  'Rangemaster', 'Cry Baby Wah', 'Whammy Octave', 'Dyna Comp',
] as const;`;
const replacement = `check(railC.includes(${JSON.stringify(expectedBlock)}), 'stomp', 'fourteen stable ordered Stomp UI labels');`;
const next = source.replace(pattern, replacement);
if (next === source) throw new Error('missing generated Stomp label-count assertion');
source = next;
fs.writeFileSync(path, source, 'utf8');
console.log('Replaced global Stomp token count with exact ordered label contract.');
