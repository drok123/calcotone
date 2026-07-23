import type { ChangeEvent as ReactChangeEvent } from 'react';

export function LinearControl({
  label,
  value,
  min,
  max,
  step,
  display,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  display: string;
  onChange: (value: number) => void;
}) {
  return (
    <label className="linear-control">
      <span className="linear-header">
        <span>{label}</span>
        <strong>{display}</strong>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event: ReactChangeEvent<HTMLInputElement>) => onChange(Number(event.target.value))}
      />
    </label>
  );
}

