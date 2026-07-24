from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    target = Path(path)
    text = target.read_text()
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{path}: expected one match, found {count}: {old[:120]!r}")
    target.write_text(text.replace(old, new, 1))

# v2 layout: one Y coordinate space for screen and controls.
replace_once(
    'src/ui/faceplateLayout.ts',
    """export interface FaceplateLayout {
  version: 1;
  custom: boolean;
  viewportHeight: number;
  controlTop: number;
  controlAreaHeight: number;
  knobs: FaceplatePoint[];
  snap: number;
}""",
    """export interface FaceplateLayout {
  version: 2;
  custom: boolean;
  viewportHeight: number;
  stageHeight: number;
  knobs: FaceplatePoint[];
  snap: number;
}""",
)
replace_once(
    'src/ui/faceplateLayout.ts',
    "const STORAGE_KEY = 'calcotone.faceplate-layout.v1';",
    "const STORAGE_KEY = 'calcotone.faceplate-layout.v2';\nconst LEGACY_STORAGE_KEY = 'calcotone.faceplate-layout.v1';",
)
replace_once(
    'src/ui/faceplateLayout.ts',
    """export const FACTORY_FACEPLATE_LAYOUT: FaceplateLayout = {
  version: 1,
  custom: true,
  viewportHeight: 192,
  controlTop: 204,
  controlAreaHeight: 322,
  knobs: [
    { x: 0.15929910480312698, y: 160 },
    { x: 0.5, y: 160 },
    { x: 0.85451197053407, y: 160 },
    { x: 0.15929910480312698, y: 264 },
    { x: 0.5, y: 264 },
    { x: 0.85451197053407, y: 264 },
  ],
  snap: 8,
};""",
    """export const FACTORY_FACEPLATE_LAYOUT: FaceplateLayout = {
  version: 2,
  custom: true,
  viewportHeight: 192,
  stageHeight: 526,
  knobs: [
    { x: 0.15929910480312698, y: 364 },
    { x: 0.5, y: 364 },
    { x: 0.85451197053407, y: 364 },
    { x: 0.15929910480312698, y: 468 },
    { x: 0.5, y: 468 },
    { x: 0.85451197053407, y: 468 },
  ],
  snap: 8,
};""",
)
replace_once(
    'src/ui/faceplateLayout.ts',
    "candidateIndex === index ? { x: clamp(point.x, 0.07, 0.93), y: clamp(point.y, 46, state.layout.controlAreaHeight - 46) } : candidate",
    "candidateIndex === index ? { x: clamp(point.x, 0.07, 0.93), y: clamp(point.y, 46, state.layout.stageHeight - 46) } : candidate",
)
replace_once(
    'src/ui/faceplateLayout.ts',
    """  const firstRowY = Math.min(...state.layout.knobs.map((point) => point.y));
  const collisionSafeMaximum = Math.max(160, state.layout.controlTop + firstRowY - 52);""",
    """  const firstRowY = Math.min(...state.layout.knobs.map((point) => point.y));
  const collisionSafeMaximum = Math.max(160, firstRowY - 52);""",
)
replace_once(
    'src/ui/faceplateLayout.ts',
    """    version: 1,
    custom: true,
    viewportHeight: viewport.offsetHeight || FACTORY_FACEPLATE_LAYOUT.viewportHeight,
    controlTop: (viewport.offsetHeight || FACTORY_FACEPLATE_LAYOUT.viewportHeight) + 12,
    controlAreaHeight: Math.max(controlSurface.offsetHeight, Math.max(...knobs.map((point) => point.y)) + 54),
    knobs,
    snap: 8,""",
    """    version: 2,
    custom: true,
    viewportHeight: viewport.offsetHeight || FACTORY_FACEPLATE_LAYOUT.viewportHeight,
    stageHeight: Math.max(
      (viewport.offsetHeight || FACTORY_FACEPLATE_LAYOUT.viewportHeight) + 12,
      (viewport.offsetHeight || FACTORY_FACEPLATE_LAYOUT.viewportHeight) + 12 + Math.max(...knobs.map((point) => point.y)) + 54,
    ),
    knobs: knobs.map((point) => ({
      ...point,
      y: (viewport.offsetHeight || FACTORY_FACEPLATE_LAYOUT.viewportHeight) + 12 + point.y,
    })),
    snap: 8,""",
)

# Replace legacy loader with v2 + explicit v1 migration.
start = "function loadSavedLayout(): FaceplateLayout {"
end = "\nfunction nearestWithin("
text = Path('src/ui/faceplateLayout.ts').read_text()
start_i = text.find(start)
end_i = text.find(end, start_i)
if start_i < 0 or end_i < 0:
    raise SystemExit('loader markers not found')
loader = r'''function loadSavedLayout(): FaceplateLayout {
  if (typeof window === 'undefined') return cloneLayout(AUTO_FACEPLATE_LAYOUT);
  try {
    const current = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? 'null') as Partial<FaceplateLayout> | null;
    if (current?.version === 2 && current.custom && Array.isArray(current.knobs) && current.knobs.length === KNOB_COUNT) {
      return sanitizeV2Layout(current);
    }

    const legacy = JSON.parse(window.localStorage.getItem(LEGACY_STORAGE_KEY) ?? 'null') as {
      version?: number;
      custom?: boolean;
      viewportHeight?: number;
      controlTop?: number;
      controlAreaHeight?: number;
      knobs?: FaceplatePoint[];
      snap?: number;
    } | null;
    if (legacy?.version === 1 && legacy.custom && Array.isArray(legacy.knobs) && legacy.knobs.length === KNOB_COUNT) {
      const viewportHeight = clamp(Number(legacy.viewportHeight) || 192, 120, 520);
      const controlTop = clamp(Number(legacy.controlTop) || viewportHeight + 12, 120, 560);
      const migrated: FaceplateLayout = {
        version: 2,
        custom: true,
        viewportHeight,
        stageHeight: Math.max(
          controlTop + clamp(Number(legacy.controlAreaHeight) || 322, 150, 420),
          controlTop + Math.max(...legacy.knobs.map((point) => Number(point.y) || 54)) + 54,
        ),
        knobs: legacy.knobs.map((point) => ({
          x: clamp(Number(point.x) || 0.5, 0.07, 0.93),
          y: controlTop + clamp(Number(point.y) || 54, 46, 314),
        })),
        snap: clamp(Number(legacy.snap) || 8, 2, 24),
      };
      try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(migrated)); } catch { /* live migration still works */ }
      return migrated;
    }
    return cloneLayout(AUTO_FACEPLATE_LAYOUT);
  } catch {
    return cloneLayout(AUTO_FACEPLATE_LAYOUT);
  }
}

function sanitizeV2Layout(layout: Partial<FaceplateLayout>): FaceplateLayout {
  const knobs = (layout.knobs ?? FACTORY_FACEPLATE_LAYOUT.knobs).map((point) => ({
    x: clamp(Number(point.x) || 0.5, 0.07, 0.93),
    y: clamp(Number(point.y) || 364, 46, 620),
  }));
  const stageHeight = clamp(
    Math.max(Number(layout.stageHeight) || 526, Math.max(...knobs.map((point) => point.y)) + 54),
    220,
    680,
  );
  return {
    version: 2,
    custom: true,
    viewportHeight: clamp(Number(layout.viewportHeight) || 192, 120, Math.max(120, Math.min(520, Math.min(...knobs.map((point) => point.y)) - 52))),
    stageHeight,
    knobs: knobs.map((point) => ({ ...point, y: clamp(point.y, 46, stageHeight - 46) })),
    snap: clamp(Number(layout.snap) || 8, 2, 24),
  };
}
'''
Path('src/ui/faceplateLayout.ts').write_text(text[:start_i] + loader + text[end_i:])

# One stage coordinate space in the module markup.
replace_once(
    'src/components/effects/EffectModule.tsx',
    "style={{ height: `${Math.max(faceplateEditor.layout.viewportHeight + 12, faceplateEditor.layout.controlTop + faceplateEditor.layout.controlAreaHeight)}px` }}",
    "style={{ height: `${faceplateEditor.layout.stageHeight}px` }}",
)
replace_once(
    'src/components/effects/EffectModule.tsx',
    "style={{ top: `${faceplateEditor.layout.controlTop}px`, height: `${faceplateEditor.layout.controlAreaHeight}px` }}",
    "style={{ top: 0, height: `${faceplateEditor.layout.stageHeight}px` }}",
)
replace_once(
    'src/components/effects/EffectModule.tsx',
    "const point = faceplateEditor.layout.knobs[index] ?? { x: ((index % 3) + 0.5) / 3, y: index < 3 ? 160 : 264 };",
    "const point = faceplateEditor.layout.knobs[index] ?? { x: ((index % 3) + 0.5) / 3, y: index < 3 ? 364 : 468 };",
)
