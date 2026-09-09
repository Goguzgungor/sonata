'use client';
import '@/lib/sonata-bundle';
import { useEffect, useState } from 'react';

/** window.SonataUI, available after mount (null during SSR/first paint). */
export function useSonataUI() {
  const [S, setS] = useState(null);
  useEffect(() => { setS(window.SonataUI || null); }, []);
  return S;
}

export function copyText(t) {
  if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(t).catch(() => {});
  const ta = document.createElement('textarea');
  ta.value = t; document.body.appendChild(ta); ta.select();
  try { document.execCommand('copy'); } catch (e) {}
  document.body.removeChild(ta);
}

export function download(name, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type: type || 'text/plain' }));
  const a = document.createElement('a');
  a.href = url; a.download = name; document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 0);
}
