type ChordDefinition = {
  label: string;
  pitches: readonly number[];
};

type Progression = {
  label: string;
  chords: readonly string[];
};

const CHORDS: Record<string, ChordDefinition> = {
  C: { label: 'C', pitches: [11, 7, 4] },
  Dm: { label: 'Dm', pitches: [9, 6, 2] },
  Em: { label: 'Em', pitches: [7, 4, 0] },
  F: { label: 'F', pitches: [11, 6, 2] },
  G: { label: 'G', pitches: [9, 4, 0] },
  Am: { label: 'Am', pitches: [11, 7, 2] },
  Bdim: { label: 'B°', pitches: [9, 6, 0] },
};

const PROGRESSIONS: readonly Progression[] = [
  { label: 'POP', chords: ['C', 'G', 'Am', 'F'] },
  { label: 'SOUL', chords: ['Am', 'F', 'C', 'G'] },
  { label: 'DREAM', chords: ['F', 'Am', 'Em', 'G'] },
  { label: 'DARK', chords: ['Am', 'Em', 'F', 'Dm'] },
  { label: 'RISE', chords: ['C', 'Dm', 'Em', 'F'] },
];

const SLOT_COUNT = 4;
const CHORD_STEPS = [0, 4, 8, 12] as const;
const selectedChords = ['C', 'G', 'Am', 'F'];
let applying = false;

function click(element: Element | null): void {
  if (!(element instanceof HTMLElement)) return;
  element.click();
}

function waitForPaint(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });
}

function synthRoot(): HTMLElement | null {
  return document.querySelector<HTMLElement>('.module-synth .synth-roll');
}

async function selectPattern(root: HTMLElement, index: number): Promise<void> {
  const buttons = root.querySelectorAll<HTMLButtonElement>('.synth-pattern-strip > button');
  click(buttons[index] ?? null);
  await waitForPaint();
}

function clearVisiblePattern(root: HTMLElement): void {
  root.querySelectorAll<HTMLButtonElement>('.piano-roll-cell-hit[aria-pressed="true"]').forEach((button) => button.click());
}

async function extendVisibleNotes(root: HTMLElement, length: number): Promise<void> {
  await waitForPaint();
  root.querySelectorAll<HTMLElement>('.piano-roll-note-handle').forEach((handle) => {
    for (let step = 1; step < length; step += 1) {
      handle.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    }
  });
}

async function writeChordPattern(root: HTMLElement, patternIndex: number, chordId: string): Promise<void> {
  const chord = CHORDS[chordId] ?? CHORDS.C;
  await selectPattern(root, patternIndex);
  clearVisiblePattern(root);
  await waitForPaint();

  const rows = root.querySelectorAll<HTMLElement>('.piano-roll-row');
  for (const pitch of chord.pitches) {
    const row = rows[pitch];
    if (!row) continue;
    for (const step of CHORD_STEPS) {
      click(row.querySelectorAll<HTMLButtonElement>('.piano-roll-cell-hit')[step] ?? null);
    }
  }
  await extendVisibleNotes(root, 4);
}

async function applyProgression(root: HTMLElement): Promise<void> {
  if (applying) return;
  applying = true;
  root.classList.add('chord-chain-writing');
  try {
    for (let index = 0; index < SLOT_COUNT; index += 1) {
      await writeChordPattern(root, index, selectedChords[index]);
    }
    await selectPattern(root, 0);
    const chainButton = root.querySelector<HTMLButtonElement>('.synth-pattern-strip .chain-button');
    if (chainButton && chainButton.getAttribute('aria-pressed') !== 'true') chainButton.click();
  } finally {
    root.classList.remove('chord-chain-writing');
    applying = false;
  }
}

function renderChordSlots(container: HTMLElement, root: HTMLElement): void {
  container.replaceChildren();
  selectedChords.forEach((chordId, index) => {
    const card = document.createElement('label');
    card.className = 'chord-chain-card';
    card.innerHTML = `<span>${index + 1}</span><select aria-label="Chord ${index + 1}"></select><small>1 BAR</small>`;
    const select = card.querySelector('select');
    if (!(select instanceof HTMLSelectElement)) return;
    Object.entries(CHORDS).forEach(([id, chord]) => {
      const option = document.createElement('option');
      option.value = id;
      option.textContent = chord.label;
      option.selected = id === chordId;
      select.append(option);
    });
    select.addEventListener('change', async () => {
      selectedChords[index] = select.value;
      await writeChordPattern(root, index, select.value);
      await selectPattern(root, index);
    });
    container.append(card);
  });
}

function installChordChain(root: HTMLElement): void {
  if (root.dataset.chordChainInstalled === 'true') return;
  root.dataset.chordChainInstalled = 'true';
  root.classList.add('chord-chain-mode');

  const panel = document.createElement('section');
  panel.className = 'chord-chain-panel';
  panel.setAttribute('aria-label', 'Chord chain sequencer');
  panel.innerHTML = `
    <header>
      <strong>CHORD CHAIN</strong>
      <span>4 × 1 BAR</span>
      <button type="button" class="chord-chain-generate">GEN</button>
    </header>
    <div class="chord-chain-cards"></div>
    <footer><span>PROGRESSION</span><strong>C › G › Am › F</strong></footer>
  `;

  const strip = root.querySelector('.synth-pattern-strip');
  root.insertBefore(panel, strip);
  const cards = panel.querySelector<HTMLElement>('.chord-chain-cards');
  const progressionLabel = panel.querySelector<HTMLElement>('footer strong');
  const generate = panel.querySelector<HTMLButtonElement>('.chord-chain-generate');
  if (!cards || !progressionLabel || !generate) return;

  renderChordSlots(cards, root);
  let progressionIndex = 0;
  generate.addEventListener('click', async () => {
    progressionIndex = (progressionIndex + 1) % PROGRESSIONS.length;
    const progression = PROGRESSIONS[progressionIndex];
    selectedChords.splice(0, SLOT_COUNT, ...progression.chords);
    progressionLabel.textContent = `${progression.label} · ${progression.chords.join(' › ')}`;
    renderChordSlots(cards, root);
    await applyProgression(root);
  });

  void applyProgression(root);
}

function scan(): void {
  const root = synthRoot();
  if (root) installChordChain(root);
}

if (typeof document !== 'undefined') {
  const observer = new MutationObserver(scan);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  scan();

  if (import.meta.hot) import.meta.hot.dispose(() => observer.disconnect());
}

export {};
