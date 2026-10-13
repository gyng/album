import { useEffect, useRef } from "react";
import styles from "./GameShortcuts.module.css";
import { useGameReadiness } from "./GameReadiness";

export type GameShortcut = {
  key: string;
  label: string;
  action: () => void;
  enabled?: boolean;
};

export const useGameShortcuts = (shortcuts: readonly GameShortcut[], active = true) => {
  const { loading } = useGameReadiness();
  const current = useRef(shortcuts);
  useEffect(() => {
    current.current = shortcuts;
  }, [shortcuts]);
  useEffect(() => {
    if (!active || loading) return;
    const handle = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.repeat || event.altKey || event.ctrlKey || event.metaKey)
        return;
      const target = event.target instanceof Element ? event.target : null;
      if (
        target?.closest("input, textarea, select, [contenteditable]:not([contenteditable='false'])")
      )
        return;
      if (document.querySelector("dialog[open], [role='dialog'][aria-modal='true']")) return;
      const key = event.key === " " ? "Space" : event.key;
      if (
        ["Enter", "Space"].includes(key) &&
        target?.closest("button, a[href], summary, [role='button'], [role='link']")
      )
        return;
      const shortcut = current.current.find(
        (item) => item.enabled !== false && item.key.toLowerCase() === key.toLowerCase(),
      );
      if (!shortcut) return;
      event.preventDefault();
      shortcut.action();
    };
    window.addEventListener("keydown", handle);
    return () => window.removeEventListener("keydown", handle);
  }, [active, loading]);
};

export const GameShortcutHelp = ({ shortcuts }: { shortcuts: readonly GameShortcut[] }) => {
  const available = shortcuts.filter((shortcut) => shortcut.enabled !== false);
  if (!available.length) return null;
  return (
    <div className={styles.help} role="note" aria-label="Keyboard shortcuts">
      {available.map(({ key, label }) => (
        <span className={styles.hint} key={key}>
          <kbd>{key === "Escape" ? "Esc" : key.length === 1 ? key.toUpperCase() : key}</kbd>
          <span>{label}</span>
        </span>
      ))}
    </div>
  );
};
