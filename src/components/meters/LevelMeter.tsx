import { clamp } from '../../ui/math';

export function LevelMeter({ label, level }: { label: string; level: number }) {
  const safeLevel = clamp(Number.isFinite(level) ? level : 0, 0, 1);
  const litSegments = Math.round(safeLevel * 16);

  return (
    <div
      className="level-meter"
      aria-label={`${label} energy ${Math.round(safeLevel * 100)} percent`}
      title={`${label} spectral energy`}
    >
      <small aria-hidden="true">{label}</small>
      {Array.from({ length: 16 }).map((_, index) => (
        <span key={index} className={index < litSegments ? 'lit' : ''} />
      ))}
    </div>
  );
}

