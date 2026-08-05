import { AppLink as Link } from "./platform";
import React from "react";
import { getRelativeTimeString } from "../util/time";
import styles from "./CalendarHeatmap.module.css";
import type { TimelineEntry } from "../util/pageDataTypes";
import {
  formatCalendarLongDate,
  formatCalendarShortDate,
  formatCalendarWeekday,
  getCalendarDominantColor,
  getCalendarLevel,
  getCalendarPopupStyle,
  getCalendarWeekIndex,
  getCalendarYearDates,
} from "./calendarHeatmapModel";
const MONTH_LABELS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];
const WEEKDAY_LABELS = ["S", "M", "T", "W", "T", "F", "S"];
const EMPTY_HIGHLIGHTED_DATES: string[] = [];
const EMPTY_HIGHLIGHTED_YEARS: number[] = [];
const EMPTY_DATE_SET = new Set<string>();

const LEVEL_CLASSES = [styles.level0, styles.level1, styles.level2, styles.level3, styles.level4];

const CalendarHeatmapYear = React.memo(
  ({
    dates,
    entriesByDate,
    effectiveTodayDate,
    highlightedDates,
    isHighlightedYear,
    onSelectDate,
    openPopup,
    closePopupSoon,
    selectedDate,
    showWeekdayLabels,
    year,
  }: {
    dates: string[];
    entriesByDate: Map<string, TimelineEntry[]>;
    effectiveTodayDate: string | null;
    highlightedDates: Set<string>;
    isHighlightedYear: boolean;
    onSelectDate: (date: string) => void;
    openPopup: (date: string, target: HTMLElement) => void;
    closePopupSoon: () => void;
    selectedDate: string | null;
    showWeekdayLabels: boolean;
    year: number;
  }) => {
    return (
      <section className={styles.yearSection} aria-label={`${year} timeline`}>
        <div className={styles.yearHeaderRow}>
          <h2
            data-year-heading={year}
            className={[
              styles.yearHeading,
              isHighlightedYear ? styles.highlightedYearHeading : "",
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
                  style={{ gridColumnStart: getCalendarWeekIndex(monthDate) + 1 }}
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
              const formattedDate = formatCalendarShortDate(date);
              const isSelected = selectedDate === date;
              const isHighlighted = highlightedDates.has(date);
              const isToday = effectiveTodayDate != null && date === effectiveTodayDate;
              const isFuture = effectiveTodayDate != null && date > effectiveTodayDate;
              const cellDate = new Date(`${date}T00:00:00Z`);
              const isInteractive = count > 0 && !isFuture;

              // The day's own colour, which the cell is painted in. It used to
              // also carry up to four pips of the individual photographs'
              // colours — three more elements on every day of every year, which
              // on a thirteen-year archive is tens of thousands of nodes for a
              // detail two pixels across.
              const dominantColor = getCalendarDominantColor(dateEntries, count);

              return (
                <div
                  key={date}
                  className={styles.cellWrap}
                  style={{
                    gridColumnStart: getCalendarWeekIndex(cellDate) + 1,
                    gridRowStart: cellDate.getUTCDay() + 1,
                  }}
                >
                  <button
                    type="button"
                    data-date={date}
                    className={[
                      styles.cell,
                      isInteractive
                        ? LEVEL_CLASSES[getCalendarLevel(count)]
                        : isFuture
                          ? styles.future
                          : styles.level0,
                      isToday ? styles.today : "",
                      isSelected ? styles.selected : "",
                      isHighlighted ? styles.memoryHighlighted : "",
                      !isInteractive ? styles.emptyCell : styles.interactiveCell,
                    ].join(" ")}
                    style={
                      dominantColor && isInteractive && !isToday
                        ? { backgroundColor: dominantColor }
                        : undefined
                    }
                    aria-label={
                      isInteractive
                        ? `${formattedDate}: ${count} ${count === 1 ? "photo" : "photos"}`
                        : `${formattedDate}: ${isFuture ? "future date" : "no photos"}`
                    }
                    aria-current={isToday ? "date" : undefined}
                    aria-pressed={isSelected}
                    aria-disabled={!isInteractive}
                    tabIndex={isInteractive ? undefined : -1}
                    onClick={isInteractive ? () => onSelectDate(date) : undefined}
                    onMouseEnter={(event) => openPopup(date, event.currentTarget)}
                    onMouseLeave={closePopupSoon}
                    onFocus={(event) => openPopup(date, event.currentTarget)}
                    onBlur={closePopupSoon}
                  />
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
  highlightedDates = EMPTY_HIGHLIGHTED_DATES,
  highlightedYears = EMPTY_HIGHLIGHTED_YEARS,
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
    () => years.map((year) => ({ year, dates: getCalendarYearDates(year) })),
    [years],
  );
  // Every year, drawn. It used to open on two and ask for the rest a few at a
  // time, which put the archive's own shape — the years it is thin in, the
  // years it is not — behind a control nobody pressed.
  const visibleYearGroups = yearGroups;

  // Only decorate "today"/future once the parent resolves the client's local
  // date (todayDate is undefined during SSG). Falling back to the build
  // machine's clock here would bake a stale "today" ring and future cells into
  // the static HTML that React never patches on hydration; when the parent's
  // client effect supplies the real date this prop changes, so the memoised
  // year re-renders instead of bailing on identical props.
  const effectiveTodayDate = todayDate ?? null;
  const highlightedDatesByYear = React.useMemo(() => {
    const grouped = new Map<number, Set<string>>();

    for (const date of highlightedDates) {
      const year = Number.parseInt(date.slice(0, 4), 10);
      const existing = grouped.get(year);
      if (existing) {
        existing.add(date);
      } else {
        grouped.set(year, new Set([date]));
      }
    }

    return grouped;
  }, [highlightedDates]);
  const highlightedYearSet = React.useMemo(() => new Set(highlightedYears), [highlightedYears]);

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
    if (!scrollToDate) {
      return;
    }

    const target = document.querySelector<HTMLElement>(`[data-date="${scrollToDate}"]`);
    const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    target?.scrollIntoView({
      behavior: prefersReducedMotion ? "auto" : "smooth",
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

  const openPopup = React.useCallback((date: string, target: HTMLElement) => {
    if (popupCloseTimer.current) {
      clearTimeout(popupCloseTimer.current);
    }

    setPopupState({ date, rect: target.getBoundingClientRect() });
  }, []);

  const popupEntries = popupState ? (entriesByDate.get(popupState.date) ?? []) : [];
  const popupPreview = popupEntries[0] ?? null;

  return (
    <div className={styles.heatmap}>
      <div className={styles.yearsScroller}>
        {visibleYearGroups.map((group) => (
          <CalendarHeatmapYear
            key={group.year}
            year={group.year}
            dates={group.dates}
            entriesByDate={entriesByDate}
            effectiveTodayDate={effectiveTodayDate}
            highlightedDates={highlightedDatesByYear.get(group.year) ?? EMPTY_DATE_SET}
            isHighlightedYear={highlightedYearSet.has(group.year)}
            onSelectDate={onSelectDate}
            openPopup={openPopup}
            closePopupSoon={closePopupSoon}
            selectedDate={selectedDate?.startsWith(`${group.year}-`) ? selectedDate : null}
            showWeekdayLabels={group.year === visibleYearGroups[0]?.year}
          />
        ))}
      </div>

      {popupState ? (
        <div
          className={styles.popup}
          style={getCalendarPopupStyle(popupState.rect, window.innerWidth)}
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
                aria-label={`View ${formatCalendarShortDate(popupState.date)} preview`}
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
                  <span>{formatCalendarWeekday(popupState.date)}</span>
                  <br />
                  <span>{formatCalendarLongDate(popupState.date)}</span>
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
          ) : (
            <div className={styles.popupDetails}>
              <strong>{formatCalendarWeekday(popupState.date)}</strong>
              <br />
              <span>{formatCalendarLongDate(popupState.date)}</span>
              <br />
              <span>{getRelativeTimeString(new Date(`${popupState.date}T12:00:00`))}</span>
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
};
