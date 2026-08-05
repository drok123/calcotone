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

const rackBlock = `            <div className="rack-random-actions" aria-label="Rack randomization controls">
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

if (!app.includes(rackBlock)) throw new Error('rack random block not found');
app = app.replace(rackBlock, '');

const controlAnchor = `          <div className="control-strip-actions">
            <span className={`;
const topBlock = `          <div className="control-strip-actions">
            <div className="top-random-actions" aria-label="Rack randomization controls">
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
            <span className={`;
app = replaceOnce(app, controlAnchor, topBlock, 'control strip insertion');

css = css.replace(/\.modules-section \{\n  position: relative;\n  padding-top: 42px;\n\}\n\n\.rack-random-actions \{[\s\S]*?\n\}\n\n\.rack-random-actions \.random-profile-selector select,\n\.rack-random-actions \.profiler-toggle \{[\s\S]*?\n\}\n/, `.modules-section {\n  position: relative;\n}\n\n.top-random-actions {\n  display: flex;\n  align-items: center;\n  justify-content: flex-end;\n  gap: 6px;\n  margin-right: auto;\n  white-space: nowrap;\n}\n\n.top-random-actions .random-profile-selector select,\n.top-random-actions .profiler-toggle {\n  height: 28px;\n  min-height: 28px;\n  padding-top: 3px;\n  padding-bottom: 3px;\n  font-size: 9px;\n}\n`);
css = css.replace(/@media \(max-width: 1500px\) \{\n  \.rack-random-actions \{[\s\S]*?\n  \}\n\n  \.rack-random-actions \.random-profile-selector select,\n  \.rack-random-actions \.profiler-toggle \{[\s\S]*?\n  \}\n\}/, `@media (max-width: 1500px) {\n  .top-random-actions {\n    gap: 4px;\n  }\n\n  .top-random-actions .random-profile-selector select,\n  .top-random-actions .profiler-toggle {\n    padding-left: 6px;\n    padding-right: 6px;\n  }\n}`);

fs.writeFileSync(appPath, app, 'utf8');
fs.writeFileSync(cssPath, css, 'utf8');
console.log('Random controls moved into the top control strip and rack spacing restored.');
