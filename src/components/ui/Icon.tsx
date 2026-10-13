import type { ReactNode } from "react";
import styles from "./Icon.module.css";

const drawings = {
  search: (
    <>
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="m16 16 5 5" />
    </>
  ),
  dice: (
    <>
      <rect x="3" y="3" width="18" height="18" rx="3" />
      <path d="M7 7h.01M17 7h.01M12 12h.01M7 17h.01M17 17h.01" strokeWidth="3" />
    </>
  ),
  image: (
    <>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <circle cx="8" cy="8" r="1.5" />
      <path d="m3 17 6-6 4 4 3-3 5 5" />
    </>
  ),
  shuffle: (
    <>
      <path d="M3 6h3c5 0 7 12 12 12h3M17 14l4 4-4 4M3 18h3c2 0 4-2 5-4m2-4c1-2 3-4 5-4h3M17 2l4 4-4 4" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 6v6l4 2" />
    </>
  ),
  compass: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="m16 8-2 6-6 2 2-6Z" />
    </>
  ),
  sunrise: (
    <>
      <path d="M3 17h18M5 21h14M7 17a5 5 0 0 1 10 0M12 3v4M4 9l3 2M20 9l-3 2" />
    </>
  ),
  repeat: (
    <>
      <path d="M4 9V7a3 3 0 0 1 3-3h13m-4-3 4 3-4 3M20 15v2a3 3 0 0 1-3 3H4m4-3-4 3 4 3" />
    </>
  ),
  expand: <path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5" />,
  sparkles: (
    <>
      <path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5Z" />
      <path d="M20 2v4m-2-2h4" />
    </>
  ),
  pin: (
    <>
      <path d="M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 1 1 14 0Z" />
      <circle cx="12" cy="10" r="2" />
    </>
  ),
  paperclip: <path d="m9 13 6-6a3 3 0 0 1 4 4l-8 8a5 5 0 0 1-7-7l9-9" />,
  camera: (
    <>
      <path d="M8 5h8l2 3h3v12H3V8h3Z" />
      <circle cx="12" cy="13" r="4" />
    </>
  ),
  pencil: (
    <>
      <path d="m4 16 12-12 4 4L8 20l-5 1Z" />
      <path d="m13 7 4 4" />
    </>
  ),
  eraser: (
    <>
      <path d="m13 3 8 8-9 10H7l-5-5Z" />
      <path d="m7 11 8 8M12 21h9" />
    </>
  ),
  undo: <path d="M8 4 3 9l5 5M3 9h10a7 7 0 0 1 0 14" />,
  redo: <path d="m16 4 5 5-5 5M21 9H11a7 7 0 0 0 0 14" />,
  clear: (
    <>
      <path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7" />
    </>
  ),
  settings: (
    <>
      <path d="M9 3h6l1 3 3 1 2 5-2 5-3 1-1 3H9l-1-3-3-1-2-5 2-5 3-1Z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  close: <path d="m6 6 12 12M6 18 18 6" />,
  flame: (
    <path d="M12 2c1 6-5 6-5 11 0 2 1 3 2 4-1-4 4-4 4-7 4 3 6 5 6 8a7 7 0 0 1-14 0C3 11 10 9 12 2Z" />
  ),
} satisfies Record<string, ReactNode>;

export type IconKind = keyof typeof drawings;
export const Icon = ({ kind }: { kind: IconKind }) => (
  <svg
    className={styles.icon}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.75"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    focusable="false"
  >
    {drawings[kind]}
  </svg>
);
