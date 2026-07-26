import { useCallback, useMemo, useState } from 'react';
import {
  DEFAULT_SERIAL_ORDER,
  describeSerialOrder,
  moveSerialModule,
  normalizeSerialOrder,
  nudgeSerialModule,
  serialRows,
  shuffledSerialOrder,
  type SerialOrder,
} from './serialRouting';

export interface SerialRoutingState {
  order: string[];
  topRow: string[];
  bottomRow: string[];
  description: string;
  setOrder: (order: SerialOrder) => void;
  move: (sourceId: string, targetId: string) => string[];
  nudge: (moduleId: string, direction: -1 | 1) => string[];
  reset: () => string[];
  randomize: () => string[];
}

export function useSerialRouting(initialOrder: SerialOrder = DEFAULT_SERIAL_ORDER): SerialRoutingState {
  const [order, setOrderState] = useState<string[]>(() => normalizeSerialOrder(initialOrder));

  const setOrder = useCallback((nextOrder: SerialOrder) => {
    setOrderState(normalizeSerialOrder(nextOrder));
  }, []);

  const move = useCallback((sourceId: string, targetId: string) => {
    let next: string[] = [];
    setOrderState((current) => {
      next = moveSerialModule(current, sourceId, targetId);
      return next;
    });
    return next;
  }, []);

  const nudge = useCallback((moduleId: string, direction: -1 | 1) => {
    let next: string[] = [];
    setOrderState((current) => {
      next = nudgeSerialModule(current, moduleId, direction);
      return next;
    });
    return next;
  }, []);

  const reset = useCallback(() => {
    const next = [...DEFAULT_SERIAL_ORDER];
    setOrderState(next);
    return next;
  }, []);

  const randomize = useCallback(() => {
    let next: string[] = [];
    setOrderState((current) => {
      next = shuffledSerialOrder(current);
      return next;
    });
    return next;
  }, []);

  const rows = useMemo(() => serialRows(order), [order]);
  const description = useMemo(() => describeSerialOrder(order), [order]);

  return {
    order,
    topRow: rows.top,
    bottomRow: rows.bottom,
    description,
    setOrder,
    move,
    nudge,
    reset,
    randomize,
  };
}
