import { useCallback, useRef, useState } from "react";

export default function useHistoryState(initialValue, limit = 60) {
  const [history, setHistory] = useState({ past: [], present: initialValue, future: [] });
  const batchingRef = useRef(false);

  const set = useCallback((updater, options = {}) => {
    setHistory((current) => {
      const next = typeof updater === "function" ? updater(current.present) : updater;
      if (Object.is(next, current.present)) return current;
      if (options.replace || batchingRef.current) {
        return { ...current, present: next };
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
