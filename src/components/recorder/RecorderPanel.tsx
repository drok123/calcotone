import type { ChangeEvent as ReactChangeEvent } from 'react';
import type { RecordedWav } from '../../audio/WavRecorder';

export interface RecordedTake extends RecordedWav {
  createdAt: Date;
}

export interface RecorderPanelProps {
  state: 'idle' | 'recording' | 'ready' | 'error';
  name: string;
  seconds: number;
  take: RecordedTake | null;
  previewUrl: string | null;
  running: boolean;
  onNameChange: (name: string) => void;
  onNameCommit: () => void;
  onStart: () => void;
  onFinish: () => void;
  onSave: () => void;
  onDiscard: () => void;
  formatDuration: (seconds: number) => string;
  formatBytes: (bytes: number) => string;
  formatPeak: (peak: number) => string;
}

export function RecorderPanel({
  state,
  name,
  seconds,
  take,
  previewUrl,
  running,
  onNameChange,
  onNameCommit,
  onStart,
  onFinish,
  onSave,
  onDiscard,
  formatDuration,
  formatBytes,
  formatPeak,
}: RecorderPanelProps) {
  return (
    <section className={`sample-recorder state-${state}`}>
      <div className="recorder-heading">
        <div className="recorder-title">
          <span className={`record-led ${state === 'recording' ? 'active' : take ? 'ready' : ''}`} aria-hidden="true" />
          <strong>RECORDER</strong>
          <small>{state === 'recording' ? 'RECORDING' : take ? 'TAKE READY' : running ? 'ARMED' : 'STANDBY'}</small>
        </div>
        <time>{formatDuration(seconds)}</time>
      </div>

      <input
        className="sample-name"
        type="text"
        aria-label="Sample name"
        maxLength={64}
        value={name}
        disabled={state === 'recording'}
        onChange={(event: ReactChangeEvent<HTMLInputElement>) => onNameChange(event.target.value)}
        onBlur={onNameCommit}
        placeholder="calcotone-sample"
      />

      <div className="recorder-controls">
        {state === 'recording' ? (
          <button type="button" className="record-stop" onClick={onFinish}>STOP</button>
        ) : (
          <button type="button" className="record-start" disabled={!running} title={running ? 'Record the final stereo output' : 'Power on CALCOTONE to record'} onClick={onStart}>REC</button>
        )}
        <button type="button" disabled={!take || state === 'recording'} onClick={onSave}>SAVE</button>
        <button
          type="button"
          className={state === 'recording' ? 'record-cancel' : ''}
          disabled={!take && state !== 'recording'}
          onClick={onDiscard}
          title={state === 'recording' ? 'Cancel the current recording' : 'Clear the captured take'}
        >
          {state === 'recording' ? 'CANCEL' : 'CLEAR'}
        </button>
      </div>

      {previewUrl && take && (
        <div className="take-preview">
          <audio controls preload="metadata" src={previewUrl} />
          <div>
            <span>{take.sampleRate} Hz · {take.bitDepth}-bit · Stereo</span>
            <span>{formatBytes(take.blob.size)} · Peak {formatPeak(take.peak)}</span>
          </div>
        </div>
      )}
    </section>
  );
}
