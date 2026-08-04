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
app = replaceOnce(
  app,
  "      if (engineState === 'running') {\n        setEffectParameterIfLoaded(\n          engineRef.current,\n          moduleId,\n          parameterId,\n          toDspParameterValue(moduleId, parameterId, modulatedValue)\n        );\n      }",
  "      if (engineState === 'running') {\n        const dspValue = toDspParameterValue(moduleId, parameterId, modulatedValue);\n        if (backendRef.current === 'native') {\n          void nativeBridgeRef.current.commandLine(`param ${moduleId} ${parameterId} ${dspValue}`);\n        } else {\n          setEffectParameterIfLoaded(engineRef.current, moduleId, parameterId, dspValue);\n        }\n      }",
  'native XY parameter routing',
);
fs.writeFileSync(appPath, app, 'utf8');
console.log('Native desktop spectrum and XY parity applied.');
