export const WEB_UI_PARITY_CONTRACT = Object.freeze({
  owner: 'shared-web-source',
  coreKnobShellPx: 76,
  coreKnobRowsPx: Object.freeze([24, 78, 19] as const),
  coreLabelRem: 0.72,
  coreValueRem: 0.65,
  viewportHeightPx: 168,
  stageHeightPx: 292,
  pressureKnobYpx: 240,
} as const);

// Browser and WebView2 render the same checked-in React/CSS faceplate. Native
// packaging may provide the window and audio host, but must never restyle it.
