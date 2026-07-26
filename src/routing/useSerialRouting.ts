import { useCallback, useMemo, useRef, useState } from 'react';
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
  setOrder: (order: SerialOrder) => string[];
  move: (sourceId: string, targetId: string) => string[];
  nudge: (moduleId: string, direction: -1 | 1) => string[];
  reset: () => string[];
  randomize: () => string[];
}

export function useSerialRouting(initialOrder: SerialOrder = DEFAULT_SERIAL_ORDER): SerialRoutingState {
  const initial = normalizeSerialOrder(initialOrder);
  const orderRef = useRef<string[]>(initial);
  const [order, setOrderState] = useState<string[]>(initial);

  const commitOrder = useCallback((nextOrder: SerialOrder): string[] => {
    const next = normalizeSerialOrder(nextOrder);
    orderRef.current = next;
    setOrderState(next);
    return next;
  }, []);

  const setOrder = useCallback((nextOrder: SerialOrder) => commitOrder(nextOrder), [commitOrder]);

  const move = useCallback((sourceId: string, targetId: string) => {
    return commitOrder(moveSerialModule(orderRef.current, sourceId, targetId));
  }, [commitOrder]);

  const nudge = useCallback((moduleId: string, direction: -1 | 1) => {
    return commitOrder(nudgeSerialModule(orderRef.current, moduleId, direction));
  }, [commitOrder]);

  const reset = useCallback(() => {
    return commitOrder(DEFAULT_SERIAL_ORDER);
  }, [commitOrder]);

  const randomize = useCallback(() => {
    return commitOrder(shuffledSerialOrder(orderRef.current));
  }, [commitOrder]);

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
