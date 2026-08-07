import { readFileSync, writeFileSync } from 'node:fs';

function replaceOnce(source, pattern, replacement, label) {
  const next = source.replace(pattern, replacement);
  if (next === source) throw new Error(`Could not patch ${label}`);
  return next;
}

const appPath = 'src/App.tsx';
let app = readFileSync(appPath, 'utf8');

app = replaceOnce(
  app,
  /          <button\n            type="button"\n            className=\{`brand brand-power \$\{isRunning \? 'running' : ''\}`\}\n            disabled=\{engineState === 'starting'\}\n            onClick=\{\(\) => void toggleAudio\(\)\}\n            aria-label=\{isRunning \? 'Power off CALCOTONE' : 'Power on CALCOTONE'\}\n          >/,
  `          <div className={\`brand brand-power \${isRunning ? 'running' : ''}\`}>`,
  'CALCOTONE brand button opening',
);

app = replaceOnce(
  app,
  `            <div className="brand-power-label">\n              <h1>{APP_NAME}</h1>\n              <small>CT-86 · STEREO PROCESSOR</small>\n            </div>\n          </button>\n\n          <div className="topbar-actions" />`,
  `            <div className="brand-power-label">\n              <h1>{APP_NAME}</h1>\n              <small>CT-86 · STEREO PROCESSOR</small>\n            </div>\n          </div>\n\n          <div className="topbar-actions">\n            <button\n              type="button"\n              className={\`calcotone-power-rocker \${isRunning ? 'running' : ''}\`}\n              disabled={engineState === 'starting'}\n              onClick={() => void toggleAudio()}\n              aria-label={isRunning ? 'Power off CALCOTONE' : 'Power on CALCOTONE'}\n              aria-pressed={isRunning}\n              title={isRunning ? 'Power off CALCOTONE' : 'Power on CALCOTONE'}\n            >\n              <span className="rocker-face" aria-hidden="true">\n                <span className="rocker-mark rocker-on">I</span>\n                <span className="rocker-mark rocker-off">O</span>\n              </span>\n            </button>\n          </div>`,
  'top-right rocker mount',
);

writeFileSync(appPath, app, 'utf8');

const cssPath = 'src/App.css';
let css = readFileSync(cssPath, 'utf8');
const marker = '/* CALCOTONE GLOBAL POWER ROCKER */';
if (!css.includes(marker)) {
  css += `\n\n${marker}\n.topbar .brand-power { cursor: default; }\n\n.calcotone-power-rocker {\n  appearance: none;\n  justify-self: end;\n  position: relative;\n  width: 58px;\n  height: 40px;\n  padding: 3px;\n  border: 1px solid #070909;\n  border-radius: 5px;\n  background: linear-gradient(180deg, #2b2f30 0%, #151819 48%, #090b0c 100%);\n  box-shadow:\n    0 4px 9px rgba(0,0,0,.42),\n    inset 0 1px rgba(255,255,255,.08),\n    inset 0 -1px rgba(0,0,0,.9);\n  cursor: pointer;\n  transition: filter 140ms ease, transform 90ms ease;\n}\n.calcotone-power-rocker:hover:not(:disabled) { filter: brightness(1.08); }\n.calcotone-power-rocker:active:not(:disabled) { transform: translateY(1px); }\n.calcotone-power-rocker:disabled { opacity: .58; cursor: wait; }\n\n.calcotone-power-rocker .rocker-face {\n  position: relative;\n  display: block;\n  width: 100%;\n  height: 100%;\n  overflow: hidden;\n  border: 1px solid #2a0908;\n  border-radius: 3px;\n  background:\n    linear-gradient(165deg, rgba(255,255,255,.055), transparent 27%),\n    linear-gradient(180deg, #39100e 0%, #210706 52%, #140504 100%);\n  box-shadow:\n    inset 0 8px 11px rgba(0,0,0,.48),\n    inset 0 -2px 5px rgba(118,18,14,.10),\n    0 1px rgba(255,255,255,.025);\n  transform: perspective(110px) rotateX(7deg);\n  transform-origin: 50% 50%;\n  transition: transform 120ms ease, background 180ms ease, border-color 180ms ease, box-shadow 220ms ease;\n}\n.calcotone-power-rocker .rocker-face::after {\n  content: '';\n  position: absolute;\n  inset: 2px 3px auto;\n  height: 38%;\n  border-radius: 2px;\n  background: linear-gradient(180deg, rgba(255,255,255,.055), rgba(255,255,255,0));\n  pointer-events: none;\n}\n.calcotone-power-rocker.running .rocker-face {\n  border-color: #55120f;\n  background:\n    linear-gradient(165deg, rgba(255,255,255,.07), transparent 28%),\n    linear-gradient(180deg, #671814 0%, #3b0b09 53%, #1d0605 100%);\n  box-shadow:\n    inset 0 -7px 11px rgba(0,0,0,.38),\n    inset 0 1px rgba(255,126,111,.08),\n    0 0 7px rgba(255,54,43,.12),\n    0 0 15px rgba(255,54,43,.045),\n    0 2px 5px rgba(0,0,0,.34);\n  transform: perspective(110px) rotateX(-7deg);\n}\n.rocker-mark {\n  position: absolute;\n  left: 50%;\n  translate: -50% 0;\n  color: rgba(225,194,187,.34);\n  font: 900 10px/1 var(--mono);\n  text-shadow: 0 1px 1px #000;\n  transition: color 180ms ease, text-shadow 180ms ease, opacity 180ms ease;\n}\n.rocker-on { top: 6px; }\n.rocker-off { bottom: 5px; opacity: .72; }\n.calcotone-power-rocker.running .rocker-on {\n  color: rgba(255,208,197,.82);\n  text-shadow: 0 0 4px rgba(255,71,57,.32), 0 1px 1px #000;\n}\n.calcotone-power-rocker.running .rocker-off { opacity: .28; }\n.calcotone-power-rocker:not(.running) .rocker-on { opacity: .24; }\n.calcotone-power-rocker:not(.running) .rocker-off { color: rgba(213,184,178,.48); }\n\n@media (prefers-reduced-motion: reduce) {\n  .calcotone-power-rocker,\n  .calcotone-power-rocker .rocker-face { transition: none !important; }\n}\n`;
}
writeFileSync(cssPath, css, 'utf8');

const auditPath = 'scripts/visual-audit.mjs';
let audit = readFileSync(auditPath, 'utf8');
const auditAnchor = `forbidText(appCss, '.viewport-caption', 'Retired duplicate artwork label styles');`;
if (!audit.includes("Top-right global CALCOTONE rocker")) {
  audit = replaceOnce(
    audit,
    auditAnchor,
    `${auditAnchor}\nrequireText(app, 'className={\`calcotone-power-rocker \\${isRunning ? \'running\' : \'\'}\`}', 'Top-right global CALCOTONE rocker');\nrequireText(app, '<span className="rocker-mark rocker-on">I</span>', 'Old-school rocker I marking');\nrequireText(app, '<span className="rocker-mark rocker-off">O</span>', 'Old-school rocker O marking');\nrequireText(appCss, '/* CALCOTONE GLOBAL POWER ROCKER */', 'Global rocker visual contract');\nrequireText(appCss, '.calcotone-power-rocker.running .rocker-face', 'Faint powered rocker glow');`,
    'visual audit rocker contract',
  );
}
writeFileSync(auditPath, audit, 'utf8');

console.log('Applied CALCOTONE global header power rocker without changing module faceplate geometry.');
