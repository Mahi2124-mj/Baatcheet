'use client';
// Press-and-hold detector: calls onOpen after the element was held for `ms` without letting go.
// No visual feedback at all, so nothing gives away that the element does anything.
import { useEffect, useRef } from 'react';

export function useLongPress(onOpen: () => void, ms = 5000) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);
  const stop = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };
  return {
    onPointerDown: (e: React.PointerEvent) => {
      e.currentTarget.setPointerCapture?.(e.pointerId);
      stop();
      timer.current = setTimeout(() => {
        timer.current = null;
        onOpen();
      }, ms);
    },
    onPointerUp: stop,
    onPointerCancel: stop,
    onLostPointerCapture: stop,
    // Long-press on phones would otherwise open the "save image / copy" menu.
    onContextMenu: (e: React.MouseEvent) => e.preventDefault(),
    style: { WebkitTouchCallout: 'none', WebkitUserSelect: 'none', userSelect: 'none', touchAction: 'none' } as React.CSSProperties,
  };
}
