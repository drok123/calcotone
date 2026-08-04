import fs from 'node:fs';

function replaceOnce(source, search, replacement, label) {
  if (source.includes(replacement)) return source;
  const count = source.split(search).length - 1;
  if (count !== 1) throw new Error(`Native desktop parity anchor ${label}: expected 1, found ${count}`);
  return source.replace(search, replacement);
}

const appPath = 'src/App.tsx';
let app = fs.readFileSync(appPath, 'utf8');
app = replaceOnce(
  app,
  "import { NativeAudioBridge, type NativeAudioHealth } from './audio/NativeAudioBridge';",
  "import { NativeAudioBridge, type NativeAudioHealth } from './audio/NativeAudioBridge';\nimport { NativeVisualSpectrum } from './visual/NativeVisualSpectrum';",
  'native spectrum import',
);
app = replaceOnce(
  app,
  "        setChannelInfo({ input: `${native.inputChannels} ch native`, output: `${native.outputChannels} ch native` });\n        setAnalyser(null);\n        setEngineState('running');",
  "        setChannelInfo({ input: `${native.inputChannels} ch native`, output: `${native.outputChannels} ch native` });\n        setAnalyser(new NativeVisualSpectrum());\n        setEngineState('running');",
  'native analyser activation',
);
fs.writeFileSync(appPath, app, 'utf8');

const cssPath = 'src/components/effects/RailCModules.css';
let css = fs.readFileSync(cssPath, 'utf8');
css = replaceOnce(
  css,
  ".module-synth.module-overlay-active > .module-header {\n  visibility: hidden;\n  pointer-events: none;\n}",
  ".module-synth.module-overlay-active {\n  position: fixed !important;\n  z-index: 10000 !important;\n  inset: 8px !important;\n  width: auto !important;\n  height: auto !important;\n  max-width: none !important;\n  max-height: none !important;\n  margin: 0 !important;\n  overflow: hidden !important;\n  transform: none !important;\n  border-radius: 10px;\n  background: #061012;\n  box-shadow: 0 0 0 9999px rgba(0,0,0,.82), 0 0 0 2px rgba(125,232,255,.34);\n}\n\n.module-synth.module-overlay-active > .module-header {\n  visibility: hidden;\n  pointer-events: none;\n}",
  'fullscreen module shell',
);
css = css.replace(
  '  position: absolute !important;\n  z-index: 80;\n  inset: 4px !important;',
  '  position: absolute !important;\n  z-index: 10001;\n  inset: 4px !important;',
);
fs.writeFileSync(cssPath, css, 'utf8');
console.log('Native desktop spectrum and fullscreen parity applied.');
