const HARDWARE_LABELS: Record<string, string> = {
  bbd: 'BBD',
  pingpong: 'Ping Pong',
  re201: 'RE-201 Space Echo',
  ce1: 'CE-1 Chorus Ensemble',
  dimensiond: 'Dimension D',
  mxrflanger: 'MXR Flanger/Doubler',
  electricmistress: 'Electric Mistress',
  adaflanger: 'A/DA Flanger',
  bf2: 'Boss BF-2',
  biphase: 'Mu-Tron Bi-Phase',
  smallstone: 'EHX Small Stone',
  univibe: 'Uni-Vibe',
  leslie: 'Leslie 122/147',
  sp1200: 'E-mu SP-1200',
  mpc60: 'Akai MPC60',
  mirage: 'Ensoniq Mirage',
  s950: 'Akai S950',
  emulator2: 'E-mu Emulator II',
  fairlightiix: 'Fairlight CMI IIx',
};

export function formatAlgorithmName(algorithm: string): string {
  return HARDWARE_LABELS[algorithm] ?? algorithm.charAt(0).toUpperCase() + algorithm.slice(1);
}
