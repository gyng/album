import { useEffect, useRef } from "react";
import styles from "./GameShortcuts.module.css";

export type GameShortcut = {
  key: string;
  label: string;
  action: () => void;
  enabled?: boolean;
};

export const useGameShortcuts = (shortcuts: readonly GameShortcut[], active = true) => {
  const current = useRef(shortcuts);
  useEffect(() => {
    current.current = shortcuts;
  }, [shortcuts]);
  useEffect(() => {
    if (!active) return;
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
  }, [active]);
};

export const GameShortcutHelp = ({ shortcuts }: { shortcuts: readonly GameShortcut[] }) => {
  const available = shortcuts.filter((shortcut) => shortcut.enabled !== false);
  if (!available.length) return null;
  return (
    <details className={styles.help}>
      <summary>Keyboard shortcuts</summary>
      <ul>
        {available.map(({ key, label }) => (
          <li key={key}>
            <kbd>{key === "Escape" ? "Esc" : key}</kbd>
            <span>{label}</span>
          </li>
        ))}
      </ul>
    </details>
  );
};
