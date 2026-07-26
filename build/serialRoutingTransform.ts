import type { Plugin } from 'vite';

function replaceRequired(source: string, before: string, after: string, label: string): string {
  if (!source.includes(before)) {
    throw new Error(`CALCOTONE serial routing transform: ${label} pattern not found`);
  }
  return source.replace(before, after);
}

function replaceRegexRequired(source: string, pattern: RegExp, after: string, label: string): string {
  if (!pattern.test(source)) {
    throw new Error(`CALCOTONE serial routing transform: ${label} pattern not found`);
  }
  return source.replace(pattern, after);
}

/**
 * Temporary App.tsx adapter.
 * Routing semantics live in src/routing/serialRouting.ts; this only adapts the
 * current monolithic App component until routing state is extracted natively.
 */
export function serialRoutingTransform(): Plugin {
  return {
    name: 'calcotone-six-slot-serial-routing',
    enforce: 'pre',
    transform(code, id) {
      if (!id.includes('/src/App.tsx') && !id.includes('\\src\\App.tsx')) return null;

      let next = code;

      next = replaceRequired(
        next,
        `import { shapeMotionSource } from './ui/motion';`,
        `import { shapeMotionSource } from './ui/motion';\nimport {\n  DEFAULT_SERIAL_ORDER,\n  moveSerialModule,\n  nudgeSerialModule,\n  serialRows,\n  shuffledSerialOrder,\n} from './routing/serialRouting';`,
        'routing model import',
      );

      next = replaceRegexRequired(
        next,
        /\nfunction shuffledSignalOrder\(current: readonly string\[\]\): string\[\] \{[\s\S]*?\n\}\n\nconst MUSICAL_RANDOM_RANGES/,
        `\nconst MUSICAL_RANDOM_RANGES`,
        'remove obsolete local signal shuffle helper',
      );

      next = replaceRegexRequired(
        next,
        /\n  function railForModule\(moduleId: string\): RoutingRail \| null \{[\s\S]*?\n  \}\n\n  function getModuleById/,
        `\n  function getModuleById`,
        'remove fixed-row membership helper',
      );

      next = replaceRegexRequired(
        next,
        /  function reorderWithinRail\(sourceId: string, targetId: string\): void \{[\s\S]*?\n  \}\n\n  function nudgeModuleWithinRail/,
        `  function reorderWithinRail(sourceId: string, targetId: string): void {\n    const nextOrder = moveSerialModule([...railAOrder, ...railBOrder], sourceId, targetId);\n    const rows = serialRows(nextOrder);\n    setRailAOrder(rows.top);\n    setRailBOrder(rows.bottom);\n    void applyRoutingOrder(rows.top, rows.bottom);\n  }\n\n  function nudgeModuleWithinRail`,
        'cross-row drag reorder',
      );

      next = replaceRegexRequired(
        next,
        /  function nudgeModuleWithinRail\(moduleId: string, direction: -1 \| 1\): void \{[\s\S]*?\n  \}\n\n  function resetRailOrder/,
        `  function nudgeModuleWithinRail(moduleId: string, direction: -1 | 1): void {\n    const nextOrder = nudgeSerialModule([...railAOrder, ...railBOrder], moduleId, direction);\n    const rows = serialRows(nextOrder);\n    setRailAOrder(rows.top);\n    setRailBOrder(rows.bottom);\n    void applyRoutingOrder(rows.top, rows.bottom);\n  }\n\n  function resetRailOrder`,
        'six-slot keyboard nudge',
      );

      next = replaceRegexRequired(
        next,
        /  function resetRailOrder\(rail: RoutingRail\): void \{[\s\S]*?\n  \}\n\n  function randomizeSignalOrder/,
        `  function resetRailOrder(_rail: RoutingRail): void {\n    const rows = serialRows(DEFAULT_SERIAL_ORDER);\n    setRailAOrder(rows.top);\n    setRailBOrder(rows.bottom);\n    setDraggedModuleId(null);\n    setDragOverModuleId(null);\n\n    if (engineState === 'running') {\n      void applyRoutingOrder(rows.top, rows.bottom);\n    } else {\n      setMessage('Signal chain reset to factory order. Applies on power-up.');\n    }\n  }\n\n  function randomizeSignalOrder`,
        'full-chain reset',
      );

      next = replaceRegexRequired(
        next,
        /  function randomizeSignalOrder\(\): void \{[\s\S]*?\n  \}\n\n  async function startAudio/,
        `  function randomizeSignalOrder(): void {\n    const nextOrder = shuffledSerialOrder([...railAOrder, ...railBOrder]);\n    const rows = serialRows(nextOrder);\n    setRailAOrder(rows.top);\n    setRailBOrder(rows.bottom);\n    setDraggedModuleId(null);\n    setDragOverModuleId(null);\n\n    if (engineState === 'running') {\n      void applyRoutingOrder(rows.top, rows.bottom);\n    } else {\n      setMessage(\n        \`Signal randomized · A \${formatRailOrder(rows.top)} · B \${formatRailOrder(rows.bottom)} · applies on power-up\`\n      );\n    }\n  }\n\n  async function startAudio`,
        'full-chain signal random',
      );

      next = replaceRegexRequired(
        next,
        /if \(!draggedModuleId \|\| railForModule\(draggedModuleId\) !== rail\) return;/g,
        `if (!draggedModuleId) return;`,
        'cross-row drop acceptance',
      );

      // Fail closed: the transformed source must no longer contain the lockout.
      if (next.includes('railForModule(draggedModuleId) !== rail')) {
        throw new Error('CALCOTONE serial routing transform: cross-row lockout survived transform');
      }

      return { code: next, map: null };
    },
  };
}
