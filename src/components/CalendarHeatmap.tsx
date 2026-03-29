import Link from "next/link";
import React from "react";
import { getRelativeTimeString } from "../util/time";
import styles from "./CalendarHeatmap.module.css";
import { TimelineEntry } from "./timelineTypes";
import { rgbToString } from "../util/colorDistance";

const DAY_MS = 24 * 60 * 60 * 1000;
const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAY_LABELS = ["S", "M", "T", "W", "T", "F", "S"];

const formatShortDate = (date: string) =>
  new Date(`${date}T00:00:00Z`).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });

const formatLongDate = (date: string) =>
  new Date(`${date}T12:00:00`).toLocaleDateString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

const formatWeekday = (date: string) =>
  new Date(`${date}T12:00:00`).toLocaleDateString(undefined, {
    weekday: "long",
  });

const getLocalDateKey = (date = new Date()) => {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const getYearDates = (year: number) => {
  const dates: string[] = [];
  const cursor = new Date(Date.UTC(year, 0, 1));

  while (cursor.getUTCFullYear() === year) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return dates;
};

const getWeekIndex = (date: Date) => {
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const startOffset = yearStart.getUTCDay();
  const dayOfYear = Math.floor((date.getTime() - yearStart.getTime()) / DAY_MS);
  return Math.floor((dayOfYear + startOffset) / 7);
};

const getLevelClassName = (count: number) => {
  if (count <= 0) return styles.level0;
  if (count === 1) return styles.level1;
  if (count <= 3) return styles.level2;
  if (count <= 6) return styles.level3;
  return styles.level4;
};

// Convert RGB to HSL
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

// Convert HSL to RGB
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

  if (s === 0) {
    return [l * 255, l * 255, l * 255];
  }

  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const r = hue2rgb(p, q, h + 1 / 3);
  const g = hue2rgb(p, q, h);
  const b = hue2rgb(p, q, h - 1 / 3);

  return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
};

// Calculate dominant color for a day and adjust saturation/value based on count
const getDominantColorForDay = (entries: TimelineEntry[], count: number): string | null => {
  if (count === 0) return null;

  // Collect all RGB colors from entries
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

  // Calculate average RGB (simple dominant color)
  const avgR = Math.round(colors.reduce((sum, [r]) => sum + r, 0) / colors.length);
  const avgG = Math.round(colors.reduce((sum, [, g]) => sum + g, 0) / colors.length);
  const avgB = Math.round(colors.reduce((sum, [, , b]) => sum + b, 0) / colors.length);

  // Convert to HSL
  const [h, s, l] = rgbToHsl(avgR, avgG, avgB);

  // Adjust saturation and lightness based on count
  // More photos = much more saturated and darker
  const countFactor = Math.min(count / 20, 1); // Normalize to 0-1 (max at 20 photos)
  const adjustedS = Math.min(s + countFactor * 0.5, 1); // Significantly increase saturation
  const adjustedL = Math.max(l - countFactor * 0.3, 0.25); // Darken more significantly

  // Convert back to RGB
  const [r, g, b] = hslToRgb(h, adjustedS, adjustedL);

  return rgbToString([r, g, b]);
};

const POPUP_WIDTH = 220;

const getPopupStyle = (rect: DOMRect): React.CSSProperties => {
  const viewportWidth = window.innerWidth;
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

const CalendarHeatmapYear = React.memo(
  ({
    dates,
    entriesByDate,
    effectiveTodayDate,
    highlightedDates,
    highlightedYears,
    onSelectDate,
    openPopup,
    closePopupSoon,
    selectedDate,
    showWeekdayLabels,
    year,
  }: {
    dates: string[];
    entriesByDate: Map<string, TimelineEntry[]>;
    effectiveTodayDate: string;
    highlightedDates: Set<string>;
    highlightedYears: Set<number>;
    onSelectDate: (date: string) => void;
    openPopup: (date: string, target: EventTarget | null) => void;
    closePopupSoon: () => void;
    selectedDate: string | null;
    showWeekdayLabels: boolean;
    year: number;
  }) => {
    return (
      <section className={styles.yearSection} aria-label={`${year} timeline`}>
        <div className={styles.yearHeaderRow}>
          <h2
            className={[
              styles.yearHeading,
              highlightedYears.has(year) ? styles.highlightedYearHeading : "",
            ].join(" ")}
          >
            {year}
          </h2>
        </div>

        <div className={styles.yearTrack}>
          <div className={styles.weekdaySpacer} aria-hidden="true" />

          <div className={styles.months} aria-hidden="true">
            {MONTH_LABELS.map((monthLabel, monthIndex) => {
              const monthDate = new Date(Date.UTC(year, monthIndex, 1));
              return (
                <span
                  key={`${year}-${monthLabel}`}
                  className={styles.monthLabel}
                  style={{ gridColumnStart: getWeekIndex(monthDate) + 1 }}
                >
                  {monthLabel}
                </span>
              );
            })}
          </div>

          {showWeekdayLabels ? (
            <div className={styles.weekdays} aria-hidden="true">
              {WEEKDAY_LABELS.map((label, i) => (
                <span key={`${year}-weekday-${i}`} className={styles.weekdayLabel}>
                  {label}
                </span>
              ))}
            </div>
          ) : null}

          <div className={styles.grid}>
            {dates.map((date) => {
              const dateEntries = entriesByDate.get(date) ?? [];
              const count = dateEntries.length;
              const formattedDate = formatShortDate(date);
              const isSelected = selectedDate === date;
              const isHighlighted = highlightedDates.has(date);
              const isToday = date === effectiveTodayDate;
              const isFuture = date > effectiveTodayDate;
              const cellDate = new Date(`${date}T00:00:00Z`);
              const isInteractive = count > 0 && !isFuture;

              // Calculate dominant color for the day (for cell background)
              const dominantColor = getDominantColorForDay(dateEntries, count);

              // Gather up to 4 unique color swatches for the pips
              let colorSwatches: string[] = [];
              for (const entry of dateEntries) {
                if (entry.placeholderColor && entry.placeholderColor !== "transparent") {
                  if (!colorSwatches.includes(entry.placeholderColor)) {
                    colorSwatches.push(entry.placeholderColor);
                  }
                }
                if (colorSwatches.length >= 4) break;
              }

              return (
                <div
                  key={date}
                  className={styles.cellWrap}
                  style={{
                    gridColumnStart: getWeekIndex(cellDate) + 1,
                    gridRowStart: cellDate.getUTCDay() + 1,
                  }}
                >
                  <button
                    type="button"
                    data-date={date}
                    className={[
                      styles.cell,
                      isInteractive
                        ? getLevelClassName(count)
                        : isFuture
                          ? styles.future
                          : styles.level0,
                      isToday ? styles.today : "",
                      isSelected ? styles.selected : "",
                      isHighlighted ? styles.memoryHighlighted : "",
                      !isInteractive ? styles.emptyCell : styles.interactiveCell,
                    ].join(" ")}
                    style={dominantColor && isInteractive ? { backgroundColor: dominantColor } : undefined}
                    aria-label={
                      isInteractive
                        ? `${formattedDate}: ${count} ${count === 1 ? "photo" : "photos"}`
                        : `${formattedDate}: ${isFuture ? "future date" : "no photos"}`
                    }
                    aria-current={isToday ? "date" : undefined}
                    aria-pressed={isSelected}
                    aria-disabled={!isInteractive}
                    onClick={isInteractive ? () => onSelectDate(date) : undefined}
                    onMouseEnter={(event) => openPopup(date, event.currentTarget)}
                    onMouseLeave={closePopupSoon}
                    onFocus={(event) => openPopup(date, event.currentTarget)}
                    onBlur={closePopupSoon}
                  >
                    {colorSwatches.length > 0 ? (
                      <span className={styles.subpips} aria-hidden="true">
                        {colorSwatches.map((color, i) => (
                          <span
                            key={color + i}
                            className={[
                              styles.subpip,
                              isHighlighted ? styles.highlightedSubpip : "",
                            ].join(" ")}
                            style={{ backgroundColor: color }}
                          />
                        ))}
                      </span>
                    ) : null}
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      </section>
    );
  },
);

CalendarHeatmapYear.displayName = "CalendarHeatmapYear";

export const CalendarHeatmap = ({
  entries,
  selectedDate,
  onSelectDate,
  todayDate,
  highlightedDates = [],
  highlightedYears = [],
  scrollToDate,
}: {
  entries: TimelineEntry[];
  selectedDate: string | null;
  onSelectDate: (date: string) => void;
  todayDate?: string;
  highlightedDates?: string[];
  highlightedYears?: number[];
  scrollToDate?: string | null;
}) => {
  const entriesByDate = React.useMemo(() => {
    const grouped = new Map<string, TimelineEntry[]>();

    for (const entry of entries) {
      const existing = grouped.get(entry.date);
      if (existing) {
        existing.push(entry);
      } else {
        grouped.set(entry.date, [entry]);
      }
    }

    return grouped;
  }, [entries]);

  const years = React.useMemo(() => {
    return Array.from(
      new Set(entries.map((entry) => Number.parseInt(entry.date.slice(0, 4), 10))),
    ).sort((left, right) => right - left);
  }, [entries]);

  const yearGroups = React.useMemo(
    () => years.map((year) => ({ year, dates: getYearDates(year) })),
    [years],
  );

  const effectiveTodayDate = React.useMemo(
    () => todayDate ?? getLocalDateKey(),
    [todayDate],
  );
  const highlightedDateSet = React.useMemo(
    () => new Set(highlightedDates),
    [highlightedDates],
  );
  const highlightedYearSet = React.useMemo(
    () => new Set(highlightedYears),
    [highlightedYears],
  );

  const [popupState, setPopupState] = React.useState<{
    date: string;
    rect: DOMRect;
  } | null>(null);
  const popupCloseTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  React.useEffect(() => {
    return () => {
      if (popupCloseTimer.current) {
        clearTimeout(popupCloseTimer.current);
      }
    };
  }, []);

  React.useEffect(() => {
    if (!scrollToDate || typeof document === "undefined") {
      return;
    }

    const target = document.querySelector<HTMLElement>(
      `[data-date="${scrollToDate}"]`,
    );
    target?.scrollIntoView({
      behavior: "smooth",
      block: "nearest",
      inline: "nearest",
    });
  }, [scrollToDate]);

  const closePopupSoon = React.useCallback(() => {
    if (popupCloseTimer.current) {
      clearTimeout(popupCloseTimer.current);
    }

    popupCloseTimer.current = setTimeout(() => {
      setPopupState(null);
    }, 120);
  }, []);

  const openPopup = React.useCallback(
    (date: string, target: EventTarget | null) => {
      if (!(target instanceof HTMLElement)) {
        return;
      }

      if (popupCloseTimer.current) {
        clearTimeout(popupCloseTimer.current);
      }

      setPopupState({ date, rect: target.getBoundingClientRect() });
    },
    [],
  );

  const popupEntries = popupState ? entriesByDate.get(popupState.date) ?? [] : [];
  const popupPreview = popupEntries[0] ?? null;

  return (
    <div className={styles.heatmap}>
      <div className={styles.yearsScroller}>
        {yearGroups.map((group) => (
          <CalendarHeatmapYear
            key={group.year}
            year={group.year}
            dates={group.dates}
            entriesByDate={entriesByDate}
            effectiveTodayDate={effectiveTodayDate}
            highlightedDates={highlightedDateSet}
            highlightedYears={highlightedYearSet}
            onSelectDate={onSelectDate}
            openPopup={openPopup}
            closePopupSoon={closePopupSoon}
            selectedDate={selectedDate}
            showWeekdayLabels={group.year === yearGroups[0]?.year}
          />
        ))}
      </div>

      {popupState && popupPreview ? (
        <div
          className={styles.popup}
          style={getPopupStyle(popupState.rect)}
          onMouseEnter={() => {
            if (popupCloseTimer.current) {
              clearTimeout(popupCloseTimer.current);
            }
          }}
          onMouseLeave={() => setPopupState(null)}
        >
          {popupPreview ? (
            <>
              <Link
                href={popupPreview.href}
                className={styles.popupLink}
                aria-label={`View ${formatShortDate(popupState.date)} preview`}
              >
                <img
                  src={popupPreview.src.src}
                  className={styles.popupImage}
                  width={popupPreview.placeholderWidth}
                  height={popupPreview.placeholderHeight}
                  style={{ backgroundColor: popupPreview.placeholderColor }}
                  alt=""
                />

                <div className={styles.popupDetails}>
                  <strong>{popupPreview.album}</strong>
                  <br />
                  <span>{formatWeekday(popupState.date)}</span>
                  <br />
                  <span>{formatLongDate(popupState.date)}</span>
                  <br />
                  <span>{getRelativeTimeString(new Date(`${popupState.date}T12:00:00`))}</span>
                </div>
              </Link>

              {popupEntries.length > 1 ? (
                <button
                  type="button"
                  className={styles.moreButton}
                  onClick={() => {
                    onSelectDate(popupState.date);
                    setPopupState(null);
                  }}
                >
                  +{popupEntries.length - 1} more
                </button>
              ) : null}
            </>
          ) : null}

          {!popupPreview && popupState ? (
            <div className={styles.popupDetails}>
              <strong>{formatWeekday(popupState.date)}</strong>
              <br />
              <span>{formatLongDate(popupState.date)}</span>
              <br />
              <span>{getRelativeTimeString(new Date(`${popupState.date}T12:00:00`))}</span>
            </div>
          ) : null}
        </div>
      ) : popupState ? (
        <div
          className={styles.popup}
          style={getPopupStyle(popupState.rect)}
          onMouseEnter={() => {
            if (popupCloseTimer.current) {
              clearTimeout(popupCloseTimer.current);
            }
          }}
          onMouseLeave={() => setPopupState(null)}
        >
          <div className={styles.popupDetails}>
            <strong>{formatWeekday(popupState.date)}</strong>
            <br />
            <span>{formatLongDate(popupState.date)}</span>
            <br />
            <span>{getRelativeTimeString(new Date(`${popupState.date}T12:00:00`))}</span>
          </div>
        </div>
      ) : null}
    </div>
  );
};
