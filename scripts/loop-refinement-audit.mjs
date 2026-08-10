import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (path) => readFileSync(resolve(process.cwd(), path), 'utf8');
const css = read('src/loopRefinement.css');
const display = read('src/components/ascii/LoopTrackMatrixDisplay.tsx');
const main = read('src/main.tsx');
const failures = [];
const requireText = (source, needle, label) => {
  if (!source.includes(needle)) failures.push(`${label}: missing ${JSON.stringify(needle)}`);
};
const forbidText = (source, needle, label) => {
  if (source.includes(needle)) failures.push(`${label}: forbidden ${JSON.stringify(needle)}`);
};

requireText(main, "import './loopRefinement.css'", 'Loop refinement layer installed');
requireText(css, '.module-pressure {', 'Loop refinement is module-scoped');
forbidText(css, '.module-stomp', 'Loop refinement must not touch Stomp');
forbidText(css, '.module-chaos', 'Loop refinement must not touch Stack');
requireText(css, '--loop-grid-gap: 4px', 'Loop shared spacing token');
requireText(css, '--loop-control-height: 30px', 'Loop shared control height token');
requireText(css, '--loop-control-radius: 4px', 'Loop shared corner radius token');
requireText(css, '--loop-header-height: 92px', 'Loop two-story header height token');
requireText(css, '.module-pressure .module-header {\n  display: grid !important;', 'Loop header cannot regress to global flex layout');
requireText(css, '.module-pressure::after {\n  top: calc(var(--loop-module-pad) + var(--loop-header-height) + var(--loop-header-gap));', 'Loop chassis divider follows refined header');
requireText(css, 'grid-template-columns: repeat(7, minmax(0, 1fr))', 'Loop seven-column placement contract');
requireText(css, '.module-pressure .loop-505-tools {\n  display: contents;', '505 actions participate in main grid');
requireText(css, 'grid-column: span 2;', 'TRIM IN/OUT receive two equal columns');
requireText(css, 'min-height: 31px !important', 'Loop track pads retain large hit target');
requireText(css, 'width: 66px;', 'Loop channel-strip width is uniform');
requireText(display, 'Math.max(62, Math.min(72', '1440p Loop display uses readable column density');
requireText(display, 'Math.max(16, Math.min(20', 'Loop display avoids vertical glyph crushing');
requireText(display, 'context.font = `800 ${fontSize}px', 'Loop display uses heavier readable glyphs');
requireText(display, 'if (selected) {', 'Selected Loop track gets explicit display emphasis');
requireText(display, 'if (inDelta < 0.022)', 'TRIM IN marker gets wider visual hit');
requireText(display, 'if (outDelta < 0.022)', 'TRIM OUT marker gets wider visual hit');

if (failures.length) {
  console.error(`Loop refinement audit failed (${failures.length})`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('CALCOTONE Loop refinement audit passed · Loop-only scope, fixed grid cascade, 7-column uniform deck, readable matrix, and large trim controls locked');
