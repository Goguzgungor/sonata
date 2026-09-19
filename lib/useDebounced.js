'use client';
import { useEffect, useState } from 'react';

/** Returns `value`, updated only once it has stayed unchanged for `ms` milliseconds. */
export function useDebounced(value, ms) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return debounced;
}
