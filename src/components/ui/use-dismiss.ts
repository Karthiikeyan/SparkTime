"use client";

import { useEffect, type RefObject } from "react";

/**
 * Closes a popover (menu, dropdown) on Escape or on a pointer press outside
 * `ref`. Escape returns focus to the element that opened it, if given.
 */
export function useDismiss(ref: RefObject<HTMLElement | null>, open: boolean, onClose: () => void, returnFocus?: RefObject<HTMLElement | null>) {
  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      onClose();
      returnFocus?.current?.focus();
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [ref, open, onClose, returnFocus]);
}
