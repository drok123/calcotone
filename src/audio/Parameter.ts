export type ParameterTaper = 'linear' | 'logarithmic' | 'exponential' | 'custom';

export interface ParameterDefinition {
  id: string;
  label: string;
  min: number;
  max: number;
  defaultValue: number;
  step?: number;
  unit?: string;
  taper?: ParameterTaper;
  smoothingTime?: number;
  fromNormalized?: (value: number) => number;
  toNormalized?: (value: number) => number;
  format?: (value: number) => string;
}

export interface ParameterState extends ParameterDefinition {
  value: number;
  normalizedValue: number;
}

export interface ModulatedParameterState {
  baseNormalized: number;
  modulationNormalized: number;
  effectiveNormalized: number;
}

export function clamp01(value: number): number {
  return Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));
}

export function clampParameter(value: number, parameter: ParameterDefinition): number {
  const safe = Number.isFinite(value) ? value : parameter.defaultValue;
  return Math.min(parameter.max, Math.max(parameter.min, safe));
}

export function normalizeParameter(value: number, parameter: ParameterDefinition): number {
  const clamped = clampParameter(value, parameter);
  if (parameter.toNormalized) return clamp01(parameter.toNormalized(clamped));

  if (parameter.taper === 'logarithmic' && parameter.min > 0) {
    return clamp01(Math.log(clamped / parameter.min) / Math.log(parameter.max / parameter.min));
  }

  return clamp01((clamped - parameter.min) / Math.max(parameter.max - parameter.min, Number.EPSILON));
}

export function denormalizeParameter(normalizedValue: number, parameter: ParameterDefinition): number {
  const normalized = clamp01(normalizedValue);
  if (parameter.fromNormalized) return clampParameter(parameter.fromNormalized(normalized), parameter);

  if (parameter.taper === 'logarithmic' && parameter.min > 0) {
    return parameter.min * Math.pow(parameter.max / parameter.min, normalized);
  }

  if (parameter.taper === 'exponential') {
    const shaped = normalized * normalized;
    return parameter.min + shaped * (parameter.max - parameter.min);
  }

  return parameter.min + normalized * (parameter.max - parameter.min);
}

export function combineModulation(baseNormalized: number, modulationNormalized: number): ModulatedParameterState {
  const base = clamp01(baseNormalized);
  const modulation = Math.min(1, Math.max(-1, modulationNormalized));
  return {
    baseNormalized: base,
    modulationNormalized: modulation,
    effectiveNormalized: clamp01(base + modulation),
  };
}
