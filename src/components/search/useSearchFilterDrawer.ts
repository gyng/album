import { useCallback, useEffect, useRef, useState } from "react";

const COMPACT_FILTER_QUERY = "(max-width: 900px)";

export const useSearchFilterDrawer = ({ isSimilarMode }: { isSimilarMode: boolean }) => {
  const [isCompact, setIsCompact] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const wasOpenRef = useRef(false);
  const open = useCallback(() => setIsOpen(true), []);
  const close = useCallback(() => setIsOpen(false), []);

  useEffect(() => {
    if (typeof window.matchMedia !== "function") {
      return;
    }

    const mediaQuery = window.matchMedia(COMPACT_FILTER_QUERY);
    const update = () => {
      setIsCompact(mediaQuery.matches);
      if (!mediaQuery.matches) {
        setIsOpen(false);
      }
    };
    update();
    mediaQuery.addEventListener?.("change", update);
    return () => mediaQuery.removeEventListener?.("change", update);
  }, []);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog || !isCompact) {
      return;
    }

    if (isOpen) {
      if (!dialog.open) {
        if (dialog.showModal) {
          dialog.showModal();
        } else {
          // jsdom and older embedded browsers do not expose showModal().
          dialog.setAttribute("open", "");
        }
      }
      closeRef.current?.focus();
      wasOpenRef.current = true;
      return;
    }

    if (wasOpenRef.current) {
      if (dialog.open && dialog.close) {
        dialog.close();
      } else {
        dialog.removeAttribute("open");
      }
      triggerRef.current?.focus();
      wasOpenRef.current = false;
    }
  }, [isCompact, isOpen]);

  useEffect(() => {
    if (isSimilarMode) {
      // This is a deliberate prop-to-state transition: similarity mode removes
      // the drawer from the page, so its open state must not survive a later
      // return to browse mode.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      close();
    }
  }, [close, isSimilarMode]);

  return {
    isCompact,
    isOpen,
    open,
    close,
    dialogRef,
    triggerRef,
    closeRef,
  };
};
