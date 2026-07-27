import { useEffect, useState, type ChangeEvent as ReactChangeEvent } from 'react';
import type { RecordedWav, RecorderMasterMode } from '../../audio/WavRecorder';

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

function blobForMode(take: RecordedTake, mode: RecorderMasterMode): Blob {
  if (mode === 'raw') return take.rawBlob;
  if (mode === 'loud') return take.loudBlob;
  return take.cleanBlob;
}

function peakForMode(take: RecordedTake, mode: RecorderMasterMode): number {
  if (mode === 'raw') return take.rawPeak;
  if (mode === 'loud') return take.loudPeak;
  return take.cleanPeak;
}

function gainForMode(take: RecordedTake, mode: RecorderMasterMode): number {
  if (mode === 'loud') return take.loudGainDb;
  if (mode === 'clean') return take.cleanGainDb;
  return 0;
}

function safeFileName(value: string): string {
  return value.trim().replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ').slice(0, 64) || 'calcotone-sample';
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
  const [masterMode, setMasterMode] = useState<RecorderMasterMode>('clean');
  const [masterPreviewUrl, setMasterPreviewUrl] = useState<string | null>(null);

  useEffect(() => {
    setMasterMode('clean');
  }, [take]);

  useEffect(() => {
    if (!take) {
      setMasterPreviewUrl(null);
      return;
    }
    if (masterMode === 'clean' && previewUrl) {
      setMasterPreviewUrl(previewUrl);
      return;
    }
    const url = URL.createObjectURL(blobForMode(take, masterMode));
    setMasterPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [take, masterMode, previewUrl]);

  function saveSelectedMaster(): void {
    if (!take) return;
    if (masterMode === 'clean') {
      onSave();
      return;
    }
    const blob = blobForMode(take, masterMode);
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    const suffix = masterMode === 'raw' ? '-raw' : '-loud';
    anchor.href = url;
    anchor.download = `${safeFileName(name)}${suffix}.wav`;
    anchor.style.display = 'none';
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  const selectedBlob = take ? blobForMode(take, masterMode) : null;
  const selectedPeak = take ? peakForMode(take, masterMode) : 0;
  const selectedGain = take ? gainForMode(take, masterMode) : 0;

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

      <div className="recorder-master-selector" role="group" aria-label="Recorder master mode">
        <span>MASTER</span>
        {(['raw', 'clean', 'loud'] as const).map((mode) => (
          <button
            key={mode}
            type="button"
            className={masterMode === mode ? 'active' : ''}
            disabled={!take || state === 'recording'}
            aria-pressed={masterMode === mode}
            title={
              mode === 'raw'
                ? 'Untouched recorder capture'
                : mode === 'clean'
                  ? 'Gentle cleanup, level lift, and -1 dBFS ceiling'
                  : 'Stronger level lift and soft limiting for quick loud exports'
            }
            onClick={() => setMasterMode(mode)}
          >
            {mode.toUpperCase()}
          </button>
        ))}
      </div>

      <div className="recorder-controls">
        {state === 'recording' ? (
          <button type="button" className="record-stop" onClick={onFinish}>STOP</button>
        ) : (
          <button type="button" className="record-start" disabled={!running} title={running ? 'Record the final stereo output' : 'Power on CALCOTONE to record'} onClick={onStart}>REC</button>
        )}
        <button type="button" disabled={!take || state === 'recording'} onClick={saveSelectedMaster}>SAVE {take ? masterMode.toUpperCase() : ''}</button>
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

      {masterPreviewUrl && take && selectedBlob && (
        <div className="take-preview">
          <audio controls preload="metadata" src={masterPreviewUrl} />
          <div>
            <span>{take.sampleRate} Hz · {take.bitDepth}-bit · Stereo · {masterMode.toUpperCase()}</span>
            <span>
              {formatBytes(selectedBlob.size)} · Peak {formatPeak(selectedPeak)}
              {masterMode !== 'raw' ? ` · Gain ${selectedGain >= 0 ? '+' : ''}${selectedGain.toFixed(1)} dB` : ' · Untouched'}
            </span>
          </div>
        </div>
      )}
    </section>
  );
}