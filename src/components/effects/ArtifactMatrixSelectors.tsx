import type { ChangeEvent } from 'react';

import {
  ARTIFACT_CHAIN_ORDER_OPTIONS,
  ARTIFACT_CONSOLE_OPTIONS,
  ARTIFACT_TUBE_OPTIONS,
  artifactMatrixLabel,
  normalizeArtifactMatrix,
  type ArtifactMatrixState,
} from '../../features/artifact/artifactMatrix';

export function ArtifactMatrixSelectors({
  value,
  disabled = false,
  onChange,
}: {
  value: ArtifactMatrixState;
  disabled?: boolean;
  onChange: (next: ArtifactMatrixState) => void;
}) {
  const state = normalizeArtifactMatrix(value);

  const update = (key: keyof ArtifactMatrixState) => (event: ChangeEvent<HTMLSelectElement>) => {
    onChange(normalizeArtifactMatrix({
      ...state,
      [key]: Number(event.target.value),
    }));
  };

  return (
    <div
      className="artifact-matrix-selectors"
      aria-label={`Artifact analog chain: ${artifactMatrixLabel(state)}`}
    >
      <label className="algorithm-selector artifact-console-selector">
        <span className="sr-only">Artifact console</span>
        <select
          aria-label="Artifact console"
          value={state.console}
          disabled={disabled}
          onChange={update('console')}
        >
          {ARTIFACT_CONSOLE_OPTIONS.map((label, index) => (
            <option key={label} value={index}>{label}</option>
          ))}
        </select>
      </label>

      <label className="algorithm-selector artifact-tube-selector">
        <span className="sr-only">Artifact tube</span>
        <select
          aria-label="Artifact tube"
          value={state.tube}
          disabled={disabled}
          onChange={update('tube')}
        >
          {ARTIFACT_TUBE_OPTIONS.map((label, index) => (
            <option key={label} value={index}>{label}</option>
          ))}
        </select>
      </label>

      <label className="algorithm-selector artifact-order-selector">
        <span className="sr-only">Artifact analog stage order</span>
        <select
          aria-label="Artifact analog stage order"
          value={state.chainOrder}
          disabled={disabled || state.console === 0 || state.tube === 0}
          onChange={update('chainOrder')}
        >
          {ARTIFACT_CHAIN_ORDER_OPTIONS.map((label, index) => (
            <option key={label} value={index}>{label}</option>
          ))}
        </select>
      </label>
    </div>
  );
}
