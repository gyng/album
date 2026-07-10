import { useCallback, useEffect, useRef, useState } from "react";

export const useSearchFilterDrawer = ({
  isSimilarMode,
}: {
  isSimilarMode: boolean;
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const open = useCallback(() => setIsOpen(true), []);
  const close = useCallback(() => setIsOpen(false), []);

  useEffect(() => {
    if (!isOpen) return;

    closeRef.current?.focus();
    const trigger = triggerRef.current;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("keydown", handleKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
      trigger?.focus();
    };
  }, [close, isOpen]);

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
    isOpen,
    open,
    close,
    triggerRef,
    closeRef,
  };
};
