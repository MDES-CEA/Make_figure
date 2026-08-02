import { useCallback, useRef, useState } from "react";

export default function useHistoryState(initialValue, limit = 60) {
  const [history, setHistory] = useState({ past: [], present: initialValue, future: [] });
  const batchingRef = useRef(false);
  const coalesceRef = useRef({ key: null, time: 0 });

  const set = useCallback((updater, options = {}) => {
    setHistory((current) => {
      const next = typeof updater === "function" ? updater(current.present) : updater;
      if (Object.is(next, current.present)) return current;
      if (options.replace || batchingRef.current) {
        return { ...current, present: next };
      }
      // Coalescence : des modifications rapprochées du même contrôle (slider,
      // champ numérique) ne créent qu'une seule entrée d'historique.
      const now = Date.now();
      const sameKey = options.coalesceKey && coalesceRef.current.key === options.coalesceKey && now - coalesceRef.current.time < 900;
      coalesceRef.current = options.coalesceKey ? { key: options.coalesceKey, time: now } : { key: null, time: 0 };
      if (sameKey) {
        return { ...current, present: next, future: [] };
      }
      const past = [...current.past, current.present];
      if (past.length > limit) past.splice(0, past.length - limit);
      return { past, present: next, future: [] };
    });
  }, [limit]);

  const replace = useCallback((next) => {
    setHistory({ past: [], present: next, future: [] });
  }, []);

  const undo = useCallback(() => {
    setHistory((current) => {
      if (!current.past.length) return current;
      const previous = current.past[current.past.length - 1];
      return {
        past: current.past.slice(0, -1),
        present: previous,
        future: [current.present, ...current.future],
      };
    });
  }, []);

  const redo = useCallback(() => {
    setHistory((current) => {
      if (!current.future.length) return current;
      const next = current.future[0];
      return {
        past: [...current.past, current.present],
        present: next,
        future: current.future.slice(1),
      };
    });
  }, []);

  const beginBatch = useCallback(() => { batchingRef.current = true; }, []);
  const endBatch = useCallback(() => { batchingRef.current = false; }, []);

  return {
    value: history.present,
    set,
    replace,
    undo,
    redo,
    canUndo: history.past.length > 0,
    canRedo: history.future.length > 0,
    beginBatch,
    endBatch,
  };
}
