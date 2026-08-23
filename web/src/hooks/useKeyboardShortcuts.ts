import { useEffect, useRef } from 'react';

type Handler = (e: KeyboardEvent) => void;
type Bindings = Record<string, Handler>;

function isEditable(el: Element | null): boolean {
  if (!el) return false;
  const tag = el.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if ((el as HTMLElement).isContentEditable) return true;
  return false;
}

export function useKeyboardShortcuts(bindings: Bindings, enabled = true) {
  // 用 ref 存储最新 bindings，避免因对象引用变化导致 effect 反复挂载
  const bindingsRef = useRef(bindings);
  bindingsRef.current = bindings;

  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (isEditable(document.activeElement)) return;
      const key = e.key.toLowerCase();
      const handler = bindingsRef.current[key];
      if (handler) {
        e.preventDefault();
        handler(e);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [enabled]);
}
