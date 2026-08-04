import { describe, expect, it, vi } from 'vitest';

import {
  ARTIFACT_CHAIN_ORDER_OPTIONS,
  ARTIFACT_CONSOLE_OPTIONS,
  ARTIFACT_TUBE_OPTIONS,
  NEVE_GOLD_LION_ARTIFACT_MATRIX,
  artifactMatrixLabel,
  normalizeArtifactMatrix,
  randomizeArtifactMatrix,
  restoreArtifactMatrix,
  serializeArtifactMatrix,
} from './artifactMatrix';

describe('Artifact matrix state', () => {
  it('keeps the console, tube, and order ABI stable', () => {
    expect(ARTIFACT_CONSOLE_OPTIONS).toHaveLength(6);
    expect(ARTIFACT_TUBE_OPTIONS).toHaveLength(6);
    expect(ARTIFACT_CHAIN_ORDER_OPTIONS).toHaveLength(2);
    expect(ARTIFACT_CONSOLE_OPTIONS[2]).toBe('Neve 1073');
    expect(ARTIFACT_TUBE_OPTIONS[1]).toBe('Gold Lion');
  });

  it('migrates the historical Neve preset to the old Neve and Gold Lion sound', () => {
    expect(restoreArtifactMatrix({}, 'Neve 1073')).toEqual(NEVE_GOLD_LION_ARTIFACT_MATRIX);
  });

  it('prefers explicit serialized values over legacy aliases', () => {
    expect(restoreArtifactMatrix({ console: 3, tube: 2, chainOrder: 1 }, 'Neve 1073')).toEqual({
      console: 3,
      tube: 2,
      chainOrder: 1,
    });
  });

  it('clamps malformed state before it reaches the native bridge', () => {
    expect(normalizeArtifactMatrix({ console: 99, tube: -4, chainOrder: 8 })).toEqual({
      console: 5,
      tube: 0,
      chainOrder: 1,
    });
  });

  it('serializes using the native parameter names', () => {
    expect(serializeArtifactMatrix({ console: 4, tube: 5, chainOrder: 1 })).toEqual({
      console: 4,
      tube: 5,
      chainOrder: 1,
    });
  });

  it('describes either processing order clearly', () => {
    expect(artifactMatrixLabel({ console: 3, tube: 2, chainOrder: 0 })).toBe('SSL 4000E → Mullard');
    expect(artifactMatrixLabel({ console: 3, tube: 2, chainOrder: 1 })).toBe('Mullard → SSL 4000E');
  });

  it('can randomize without changing the selected order', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.75);
    expect(randomizeArtifactMatrix({
      includeBypass: false,
      preserveOrder: true,
      current: { console: 2, tube: 1, chainOrder: 1 },
    }).chainOrder).toBe(1);
    vi.restoreAllMocks();
  });
});
