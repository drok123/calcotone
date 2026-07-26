import type { Plugin } from 'vite';

function replaceRequired(source: string, before: string, after: string, label: string): string {
  if (!source.includes(before)) {
    throw new Error(`CALCOTONE serial routing transform: ${label} pattern not found`);
  }
  return source.replace(before, after);
}

/**
 * Temporary App.tsx adapter.
 *
 * Routing semantics now live in src/routing/serialRouting.ts. This transform only
 * bridges the monolithic App component to that model until App routing state can be
 * extracted cleanly. Keep this fail-fast and deliberately free of routing logic.
 */
export function serialRoutingTransform(): Plugin {
  return {
    name: 'calcotone-six-slot-serial-routing',
    enforce: 'pre',
    transform(code, id) {
      if (!/[/\\]src[/\\]App\.tsx(?:\?|$)/.test(id)) return null;

      let next = code;

      next = replaceRequired(
        next,
        `import { shapeMotionSource } from './ui/motion';`,
        `import { shapeMotionSource } from './ui/motion';\nimport {\n  DEFAULT_SERIAL_ORDER,\n  moveSerialModule,\n  nudgeSerialModule,\n  serialRows,\n  shuffledSerialOrder,\n} from './routing/serialRouting';`,
        'routing model import',
      );

      next = replaceRequired(
        next,
        `  function railForModule(moduleId: string): RoutingRail | null {\n    if (railAOrder.includes(moduleId)) return 'A';\n    if (railBOrder.includes(moduleId)) return 'B';\n    return null;\n  }\n\n`,
        '',
        'remove obsolete fixed-rail membership helper',
      );

      next = replaceRequired(
        next,
        `  function reorderWithinRail(sourceId: string, targetId: string): void {\n    if (sourceId === targetId) return;\n    const sourceRail = railForModule(sourceId);\n    const targetRail = railForModule(targetId);\n\n    if (!sourceRail || sourceRail !== targetRail) {\n      setMessage('Modules stay on their three-slot rail in this routing version.');\n      return;\n    }\n\n    const current = sourceRail === 'A' ? railAOrder : railBOrder;\n    const next = [...current];\n    const from = next.indexOf(sourceId);\n    const to = next.indexOf(targetId);\n    if (from < 0 || to < 0) return;\n\n    next.splice(from, 1);\n    next.splice(to, 0, sourceId);\n\n    const nextA = sourceRail === 'A' ? next : railAOrder;\n    const nextB = sourceRail === 'B' ? next : railBOrder;\n\n    if (sourceRail === 'A') setRailAOrder(next);\n    else setRailBOrder(next);\n\n    void applyRoutingOrder(nextA, nextB);\n  }`,
        `  function reorderWithinRail(sourceId: string, targetId: string): void {\n    const next = moveSerialModule([...railAOrder, ...railBOrder], sourceId, targetId);\n    const rows = serialRows(next);\n    setRailAOrder(rows.top);\n    setRailBOrder(rows.bottom);\n    void applyRoutingOrder(rows.top, rows.bottom);\n  }`,
        'cross-row drag reorder',
      );

      next = replaceRequired(
        next,
        `  function nudgeModuleWithinRail(moduleId: string, direction: -1 | 1): void {\n    const rail = railForModule(moduleId);\n    if (!rail) return;\n\n    const current = rail === 'A' ? railAOrder : railBOrder;\n    const index = current.indexOf(moduleId);\n    const targetIndex = index + direction;\n    if (index < 0 || targetIndex < 0 || targetIndex >= current.length) return;\n\n    const next = [...current];\n    [next[index], next[targetIndex]] = [next[targetIndex], next[index]];\n\n    const nextA = rail === 'A' ? next : railAOrder;\n    const nextB = rail === 'B' ? next : railBOrder;\n\n    if (rail === 'A') setRailAOrder(next);\n    else setRailBOrder(next);\n\n    void applyRoutingOrder(nextA, nextB);\n  }`,
        `  function nudgeModuleWithinRail(moduleId: string, direction: -1 | 1): void {\n    const next = nudgeSerialModule([...railAOrder, ...railBOrder], moduleId, direction);\n    const rows = serialRows(next);\n    setRailAOrder(rows.top);\n    setRailBOrder(rows.bottom);\n    void applyRoutingOrder(rows.top, rows.bottom);\n  }`,
        'six-slot keyboard nudge',
      );

      next = replaceRequired(
        next,
        `  function resetRailOrder(rail: RoutingRail): void {\n    const nextA = rail === 'A' ? [...DEFAULT_RAIL_A_ORDER] : railAOrder;\n    const nextB = rail === 'B' ? [...DEFAULT_RAIL_B_ORDER] : railBOrder;\n\n    if (rail === 'A') setRailAOrder(nextA);\n    else setRailBOrder(nextB);\n\n    setDraggedModuleId(null);\n    setDragOverModuleId(null);\n\n    if (engineState === 'running') {\n      void applyRoutingOrder(nextA, nextB);\n    } else {\n      setMessage(\`Rail \${rail} reset to factory order. Applies on power-up.\`);\n    }\n  }`,
        `  function resetRailOrder(_rail: RoutingRail): void {\n    const rows = serialRows(DEFAULT_SERIAL_ORDER);\n    setRailAOrder(rows.top);\n    setRailBOrder(rows.bottom);\n    setDraggedModuleId(null);\n    setDragOverModuleId(null);\n\n    if (engineState === 'running') {\n      void applyRoutingOrder(rows.top, rows.bottom);\n    } else {\n      setMessage('Signal chain reset to factory order. Applies on power-up.');\n    }\n  }`,
        'safe full-chain reset',
      );

      next = replaceRequired(
        next,
        `  function randomizeSignalOrder(): void {\n    let nextA = shuffledSignalOrder(railAOrder);\n    let nextB = shuffledSignalOrder(railBOrder);\n\n    // Extremely defensive: make sure the combined topology changes even if\n    // future rail sizes/memberships alter the shuffle behavior.\n    const unchangedA = nextA.every((id, index) => id === railAOrder[index]);\n    const unchangedB = nextB.every((id, index) => id === railBOrder[index]);\n    if (unchangedA && unchangedB) {\n      nextA = [...railAOrder.slice(1), railAOrder[0]];\n    }\n\n    setRailAOrder(nextA);\n    setRailBOrder(nextB);\n    setDraggedModuleId(null);\n    setDragOverModuleId(null);\n\n    if (engineState === 'running') {\n      void applyRoutingOrder(nextA, nextB);\n    } else {\n      setMessage(\n        \`Signal randomized · A \${formatRailOrder(nextA)} · B \${formatRailOrder(nextB)} · applies on power-up\`\n      );\n    }\n  }`,
        `  function randomizeSignalOrder(): void {\n    const next = shuffledSerialOrder([...railAOrder, ...railBOrder]);\n    const rows = serialRows(next);\n    setRailAOrder(rows.top);\n    setRailBOrder(rows.bottom);\n    setDraggedModuleId(null);\n    setDragOverModuleId(null);\n\n    if (engineState === 'running') {\n      void applyRoutingOrder(rows.top, rows.bottom);\n    } else {\n      setMessage(\n        \`Signal randomized · A \${formatRailOrder(rows.top)} · B \${formatRailOrder(rows.bottom)} · applies on power-up\`\n      );\n    }\n  }`,
        'full-chain signal random',
      );

      next = replaceRequired(
        next,
        `                            if (!draggedModuleId || railForModule(draggedModuleId) !== rail) return;`,
        `                            if (!draggedModuleId) return;`,
        'cross-row drop acceptance',
      );

      return { code: next, map: null };
    },
  };
}
