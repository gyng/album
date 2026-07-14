import type { TimelineEntry } from "./timelineTypes";
import { rgbToString } from "../util/colorDistance";

const DAY_MS = 24 * 60 * 60 * 1000;
const POPUP_WIDTH = 220;

export const formatCalendarShortDate = (date: string) =>
  new Date(`${date}T00:00:00Z`).toLocaleDateString("en-GB", {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });

export const formatCalendarLongDate = (date: string) =>
  new Date(`${date}T12:00:00`).toLocaleDateString("en-GB", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

export const formatCalendarWeekday = (date: string) =>
  new Date(`${date}T12:00:00`).toLocaleDateString("en-GB", { weekday: "long" });

export const getCalendarYearDates = (year: number): string[] => {
  const dates: string[] = [];
  const cursor = new Date(Date.UTC(year, 0, 1));

  while (cursor.getUTCFullYear() === year) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return dates;
};

export const getCalendarWeekIndex = (date: Date): number => {
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const startOffset = yearStart.getUTCDay();
  const dayOfYear = Math.floor((date.getTime() - yearStart.getTime()) / DAY_MS);
  return Math.floor((dayOfYear + startOffset) / 7);
};

export const getCalendarLevel = (count: number): 0 | 1 | 2 | 3 | 4 => {
  if (count <= 0) return 0;
  if (count === 1) return 1;
  if (count <= 3) return 2;
  if (count <= 6) return 3;
  return 4;
};

const rgbToHsl = (r: number, g: number, b: number): [number, number, number] => {
  r /= 255;
  g /= 255;
  b /= 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);

    switch (max) {
      case r:
        h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
        break;
      case g:
        h = ((b - r) / d + 2) / 6;
        break;
      case b:
        h = ((r - g) / d + 4) / 6;
        break;
    }
  }

  return [h * 360, s, l];
};

const hslToRgb = (h: number, s: number, l: number): [number, number, number] => {
  h /= 360;

  const hue2rgb = (p: number, q: number, t: number) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };

  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const r = hue2rgb(p, q, h + 1 / 3);
  const g = hue2rgb(p, q, h);
  const b = hue2rgb(p, q, h - 1 / 3);

  return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
};

export const getCalendarDominantColor = (
  entries: TimelineEntry[],
  count: number,
): string | null => {
  if (count === 0) return null;

  const colors: [number, number, number][] = [];
  for (const entry of entries) {
    if (entry.placeholderColor && entry.placeholderColor !== "transparent") {
      const match = entry.placeholderColor.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
      if (match) {
        colors.push([parseInt(match[1]), parseInt(match[2]), parseInt(match[3])]);
      }
    }
  }

  if (colors.length === 0) return null;

  const avgR = Math.round(colors.reduce((sum, [r]) => sum + r, 0) / colors.length);
  const avgG = Math.round(colors.reduce((sum, [, g]) => sum + g, 0) / colors.length);
  const avgB = Math.round(colors.reduce((sum, [, , b]) => sum + b, 0) / colors.length);
  const [h, s, l] = rgbToHsl(avgR, avgG, avgB);
  const countFactor = Math.min(count / 20, 1);
  const adjustedS = Math.min(s + countFactor * 0.5, 1);
  const adjustedL = Math.max(l - countFactor * 0.3, 0.25);
  const [r, g, b] = hslToRgb(h, adjustedS, adjustedL);

  return rgbToString([r, g, b]);
};

export const getCalendarPopupStyle = (
  rect: Pick<DOMRect, "left" | "top" | "width">,
  viewportWidth: number,
): React.CSSProperties => {
  const centeredLeft = rect.left + rect.width / 2;
  const minLeft = POPUP_WIDTH / 2 + 12;
  const maxLeft = viewportWidth - POPUP_WIDTH / 2 - 12;
  const clampedLeft = Math.max(minLeft, Math.min(maxLeft, centeredLeft));

  return {
    position: "fixed",
    left: `${clampedLeft}px`,
    top: `${Math.max(12, rect.top - 12)}px`,
    transform: "translate(-50%, -100%)",
  };
};
