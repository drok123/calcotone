import fs from 'node:fs';

const appPath = 'src/App.tsx';
const cssPath = 'src/App.css';
let app = fs.readFileSync(appPath, 'utf8').replace(/\r\n?/g, '\n');
let css = fs.readFileSync(cssPath, 'utf8').replace(/\r\n?/g, '\n');

function replaceOnce(source, search, replacement, label) {
  const count = source.split(search).length - 1;
  if (count !== 1) throw new Error(`${label}: expected one anchor, found ${count}`);
  return source.replace(search, replacement);
}

if (!app.includes('const [appFullscreen, setAppFullscreen]')) {
  app = app.replace(
    /(const \[isFullscreen, setIsFullscreen\] = useState\(false\);)/,
    `$1\n  const [appFullscreen, setAppFullscreen] = useState(false);`,
  );
  if (!app.includes('const [appFullscreen, setAppFullscreen]')) throw new Error('fullscreen state anchor missing');
}

if (!app.includes('const fullscreenActive = isFullscreen || appFullscreen;')) {
  app = replaceOnce(
    app,
    "  const isRunning = engineState === 'running';",
    "  const fullscreenActive = isFullscreen || appFullscreen;\n  const isRunning = engineState === 'running';",
    'fullscreen active state',
  );
}

const oldToggle = `  async function toggleFullscreen(): Promise<void> {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else {
        await document.documentElement.requestFullscreen();
      }
    } catch {
      setMessage('Fullscreen was blocked by the browser. Use the preview in its own tab.');
    }
  }`;
const newToggle = `  async function toggleFullscreen(): Promise<void> {
    if (appFullscreen) {
      setAppFullscreen(false);
      return;
    }
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
        return;
      }
      if (document.fullscreenEnabled && document.documentElement.requestFullscreen) {
        await document.documentElement.requestFullscreen();
        return;
      }
    } catch {
      // WebView2 may reject the browser Fullscreen API. Fall through to the
      // native-safe viewport mode so the hardware control always works.
    }
    setAppFullscreen(true);
    setMessage('CALCOTONE fullscreen workspace enabled.');
  }`;
if (app.includes(oldToggle)) app = app.replace(oldToggle, newToggle);
else if (!app.includes('CALCOTONE fullscreen workspace enabled.')) throw new Error('fullscreen function anchor missing');

app = app.replace('<div className="app-shell">', '<div className={`app-shell ${appFullscreen ? \'app-fullscreen\' : \'\'}`}>');
app = app.replaceAll("${isFullscreen ? 'active' : ''}", "${fullscreenActive ? 'active' : ''}");
app = app.replaceAll('aria-pressed={isFullscreen}', 'aria-pressed={fullscreenActive}');
app = app.replaceAll("title={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}", "title={fullscreenActive ? 'Exit fullscreen' : 'Enter fullscreen'}");

const randomBlock = `            <label className="random-profile-selector">
              <span className="sr-only">Randomization profile</span>
              <select
                aria-label="Randomization profile"
                value={randomProfile}
                onChange={(event) => setRandomProfile(event.target.value as Exclude<RandomizationProfile, 'mutate'>)}
                title="Choose a coordinated Synth / effects randomization archetype"
              >
                {RANDOMIZATION_PROFILE_OPTIONS.map((option) => (
                  <option value={option.id} key={option.id}>{option.label}</option>
                ))}
              </select>
            </label>
            <button type="button" className="profiler-toggle randomizer-toggle" onClick={() => randomizeActiveModules(randomProfile)} title="Morph active modules into the selected guarded profile">
              RANDOM
              {randomFlowProgress && (
                <span className="randomizer-flow-count" aria-hidden="true">
                  {randomFlowProgress.current}/{randomFlowProgress.total}
                </span>
              )}
            </button>
            <button type="button" className="profiler-toggle randomizer-toggle mutate-randomizer-toggle" onClick={() => randomizeActiveModules('mutate')} title="Drift every active control by at most 10% while preserving machines and patch identity">MUTATE 10%</button>
            <button type="button" className="profiler-toggle signal-randomizer-toggle" onClick={randomizeSignalOrder} title="Randomize the order of both three-module signal rails">SIGNAL RANDOM</button>
`;

const rackRandomBlock = `            <div className="rack-random-actions" aria-label="Rack randomization controls">
              <label className="random-profile-selector">
                <span className="sr-only">Randomization profile</span>
                <select
                  aria-label="Randomization profile"
                  value={randomProfile}
                  onChange={(event) => setRandomProfile(event.target.value as Exclude<RandomizationProfile, 'mutate'>)}
                  title="Choose a coordinated effects randomization archetype"
                >
                  {RANDOMIZATION_PROFILE_OPTIONS.map((option) => (
                    <option value={option.id} key={option.id}>{option.label}</option>
                  ))}
                </select>
              </label>
              <button type="button" className="profiler-toggle randomizer-toggle" onClick={() => randomizeActiveModules(randomProfile)} title="Morph active modules into the selected guarded profile">
                RANDOM
                {randomFlowProgress && (
                  <span className="randomizer-flow-count" aria-hidden="true">
                    {randomFlowProgress.current}/{randomFlowProgress.total}
                  </span>
                )}
              </button>
              <button type="button" className="profiler-toggle randomizer-toggle mutate-randomizer-toggle" onClick={() => randomizeActiveModules('mutate')} title="Drift every active control by at most 10% while preserving machines and patch identity">MUTATE 10%</button>
              <button type="button" className="profiler-toggle signal-randomizer-toggle" onClick={randomizeSignalOrder} title="Randomize the order of both three-module signal rails">SIGNAL RANDOM</button>
            </div>
`;

if (app.includes(randomBlock)) {
  app = app.replace(randomBlock, '');
  app = replaceOnce(
    app,
    '          <section className="modules-section" aria-label="Effects modules">\n            <div className="module-grid routing-grid">',
    '          <section className="modules-section" aria-label="Effects modules">\n' + rackRandomBlock + '            <div className="module-grid routing-grid">',
    'rack random placement',
  );
} else if (!app.includes('className="rack-random-actions"')) {
  throw new Error('random controls anchor missing');
}

const cssPatch = `

/* Definitive Windows workspace controls. */
.top-quality-controls {
  width: auto !important;
  min-width: 0 !important;
  gap: 4px !important;
}

.top-quality-controls button {
  width: auto !important;
  min-width: 76px !important;
  height: 28px !important;
  padding: 3px 9px !important;
  font-size: 10px !important;
  letter-spacing: 0.07em !important;
}

.modules-section {
  position: relative;
  padding-top: 42px;
}

.rack-random-actions {
  position: absolute;
  z-index: 20;
  top: 4px;
  right: 8px;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 6px;
  white-space: nowrap;
}

.rack-random-actions .random-profile-selector select,
.rack-random-actions .profiler-toggle {
  height: 28px;
  min-height: 28px;
  padding-top: 3px;
  padding-bottom: 3px;
  font-size: 9px;
}

.app-shell.app-fullscreen {
  position: fixed;
  inset: 0;
  z-index: 99999;
  width: 100vw;
  height: 100vh;
  overflow: hidden;
  background: var(--case-dark, #171714);
}

.app-shell.app-fullscreen .canvas-stage {
  width: 2560px;
  height: 1440px;
  transform-origin: top left;
}

@media (max-width: 1500px) {
  .rack-random-actions {
    right: 4px;
    gap: 4px;
  }

  .rack-random-actions .random-profile-selector select,
  .rack-random-actions .profiler-toggle {
    padding-left: 6px;
    padding-right: 6px;
  }
}
`;
if (!css.includes('Definitive Windows workspace controls.')) css += cssPatch;

fs.writeFileSync(appPath, app, 'utf8');
fs.writeFileSync(cssPath, css, 'utf8');
console.log('Fullscreen, quality sizing, and rack random-control parity materialized.');
