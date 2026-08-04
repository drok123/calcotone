export const ARTIFACT_CONSOLE_OPTIONS = [
  'Bypass',
  'Tascam 424',
  'Neve 1073',
  'SSL 4000E',
  'API 1608',
  'Neve BCM10',
] as const;

export const ARTIFACT_TUBE_OPTIONS = [
  'Bypass',
  'Gold Lion',
  'Mullard',
  'Telefunken',
  'Bugle Boy',
  'RCA Black Plate',
] as const;

export const ARTIFACT_CHAIN_ORDER_OPTIONS = [
  'Console → Tube',
  'Tube → Console',
] as const;

export type ArtifactConsoleIndex = 0 | 1 | 2 | 3 | 4 | 5;
export type ArtifactTubeIndex = 0 | 1 | 2 | 3 | 4 | 5;
export type ArtifactChainOrderIndex = 0 | 1;

export interface ArtifactMatrixState {
  console: ArtifactConsoleIndex;
  tube: ArtifactTubeIndex;
  chainOrder: ArtifactChainOrderIndex;
}

export const DEFAULT_ARTIFACT_MATRIX: ArtifactMatrixState = {
  console: 0,
  tube: 0,
  chainOrder: 0,
};

export const NEVE_GOLD_LION_ARTIFACT_MATRIX: ArtifactMatrixState = {
  console: 2,
  tube: 1,
  chainOrder: 0,
};

function clampDiscrete(value: unknown, maximum: number): number {
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.max(0, Math.min(maximum, Math.round(numeric)));
}

export function normalizeArtifactMatrix(value: Partial<ArtifactMatrixState> | null | undefined): ArtifactMatrixState {
  return {
    console: clampDiscrete(value?.console, ARTIFACT_CONSOLE_OPTIONS.length - 1) as ArtifactConsoleIndex,
    tube: clampDiscrete(value?.tube, ARTIFACT_TUBE_OPTIONS.length - 1) as ArtifactTubeIndex,
    chainOrder: clampDiscrete(value?.chainOrder, ARTIFACT_CHAIN_ORDER_OPTIONS.length - 1) as ArtifactChainOrderIndex,
  };
}

/**
 * Restores matrix state from current discrete parameters while preserving old
 * Artifact presets that predate independent console/tube selectors.
 */
export function restoreArtifactMatrix(
  parameters: Readonly<Record<string, unknown>>,
  legacyMediaMode?: string,
): ArtifactMatrixState {
  const hasMatrix = parameters.console !== undefined
    || parameters.tube !== undefined
    || parameters.chainOrder !== undefined
    || parameters.order !== undefined;

  if (hasMatrix) {
    return normalizeArtifactMatrix({
      console: parameters.console as ArtifactConsoleIndex,
      tube: parameters.tube as ArtifactTubeIndex,
      chainOrder: (parameters.chainOrder ?? parameters.order) as ArtifactChainOrderIndex,
    });
  }

  // Preserve the historical combined path as an alias instead of forcing that
  // pairing on every console or tube selection.
  if (legacyMediaMode === 'Neve 1073') return { ...NEVE_GOLD_LION_ARTIFACT_MATRIX };
  if (legacyMediaMode === 'tascam424') return { console: 1, tube: 0, chainOrder: 0 };
  if (legacyMediaMode === 'SSL 4000E') return { console: 3, tube: 0, chainOrder: 0 };
  if (legacyMediaMode === 'API 1608') return { console: 4, tube: 0, chainOrder: 0 };
  if (legacyMediaMode === 'Neve BCM10') return { console: 5, tube: 0, chainOrder: 0 };
  return { ...DEFAULT_ARTIFACT_MATRIX };
}

export function serializeArtifactMatrix(state: ArtifactMatrixState): Record<string, number> {
  const normalized = normalizeArtifactMatrix(state);
  return {
    console: normalized.console,
    tube: normalized.tube,
    chainOrder: normalized.chainOrder,
  };
}

export interface ArtifactMatrixRandomOptions {
  includeBypass?: boolean;
  preserveOrder?: boolean;
  current?: ArtifactMatrixState;
}

export function randomizeArtifactMatrix(options: ArtifactMatrixRandomOptions = {}): ArtifactMatrixState {
  const includeBypass = options.includeBypass ?? true;
  const minimum = includeBypass ? 0 : 1;
  const choose = (maximum: number): number => minimum + Math.floor(Math.random() * (maximum - minimum + 1));
  const current = normalizeArtifactMatrix(options.current);

  return {
    console: choose(ARTIFACT_CONSOLE_OPTIONS.length - 1) as ArtifactConsoleIndex,
    tube: choose(ARTIFACT_TUBE_OPTIONS.length - 1) as ArtifactTubeIndex,
    chainOrder: (options.preserveOrder ? current.chainOrder : Math.round(Math.random())) as ArtifactChainOrderIndex,
  };
}

export function artifactMatrixLabel(state: ArtifactMatrixState): string {
  const normalized = normalizeArtifactMatrix(state);
  const consoleName = ARTIFACT_CONSOLE_OPTIONS[normalized.console];
  const tubeName = ARTIFACT_TUBE_OPTIONS[normalized.tube];
  if (normalized.console === 0 && normalized.tube === 0) return 'Analog chain bypassed';
  if (normalized.console === 0) return tubeName;
  if (normalized.tube === 0) return consoleName;
  return normalized.chainOrder === 0
    ? `${consoleName} → ${tubeName}`
    : `${tubeName} → ${consoleName}`;
}
