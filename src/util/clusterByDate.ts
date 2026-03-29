const DAY_MS = 24 * 60 * 60 * 1000;
const REFERENCE_YEAR = 2000;
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
] as const;

type DateItem = { date: string };

export type MemoryCluster<T extends DateItem> = {
  startDate: string;
  endDate: string;
  seedDates: string[];
  items: T[];
};

export type ResolvedMemoryCluster<T extends DateItem> = {
  year: number;
  yearsAgo: number;
  startDate: string;
  endDate: string;
  items: T[];
};

const parseDateParts = (date: string) => {
  const [year, month, day] = date.split("-").map(Number);
  return { year, month, day };
};

const toUtcDate = (date: string) => {
  const { year, month, day } = parseDateParts(date);
  return new Date(Date.UTC(year, month - 1, day));
};

const getDateGapDays = (left: string, right: string) => {
  return Math.round((toUtcDate(right).getTime() - toUtcDate(left).getTime()) / DAY_MS);
};

const getReferenceDayOfYear = (date: string) => {
  const { month, day } = parseDateParts(date);
  const value = new Date(Date.UTC(REFERENCE_YEAR, month - 1, day));
  const start = new Date(Date.UTC(REFERENCE_YEAR, 0, 1));
  return Math.floor((value.getTime() - start.getTime()) / DAY_MS);
};

const getCircularDayDistance = (left: string, right: string) => {
  const leftDay = getReferenceDayOfYear(left);
  const rightDay = getReferenceDayOfYear(right);
  const delta = Math.abs(leftDay - rightDay);
  return Math.min(delta, 366 - delta);
};

const groupItemsByDate = <T extends DateItem>(items: T[]) => {
  const byDate = new Map<string, T[]>();

  items.forEach((item) => {
    const current = byDate.get(item.date) ?? [];
    current.push(item);
    byDate.set(item.date, current);
  });

  return byDate;
};

export function findClustersAroundSeeds<T extends DateItem>(
  allItemsForYear: T[],
  seedDates: Set<string>,
  maxGapDays = 3,
): MemoryCluster<T>[] {
  if (allItemsForYear.length === 0 || seedDates.size === 0) {
    return [];
  }

  const itemsByDate = groupItemsByDate(allItemsForYear);
  const uniqueDates = Array.from(itemsByDate.keys()).sort((left, right) =>
    left.localeCompare(right),
  );

  const allClusters: Array<{ dates: string[] }> = [];
  let currentCluster: string[] = [];

  uniqueDates.forEach((date, index) => {
    const previousDate = uniqueDates[index - 1];
    const gapDays =
      previousDate == null ? 0 : getDateGapDays(previousDate, date);

    if (currentCluster.length === 0 || gapDays <= maxGapDays) {
      currentCluster.push(date);
      return;
    }

    allClusters.push({ dates: currentCluster });
    currentCluster = [date];
  });

  if (currentCluster.length > 0) {
    allClusters.push({ dates: currentCluster });
  }

  return allClusters
    .filter((cluster) => cluster.dates.some((date) => seedDates.has(date)))
    .map((cluster) => {
      const items = cluster.dates.flatMap((date) => itemsByDate.get(date) ?? []);
      const matchedSeedDates = cluster.dates.filter((date) => seedDates.has(date));
      return {
        startDate: cluster.dates[0] as string,
        endDate: cluster.dates[cluster.dates.length - 1] as string,
        seedDates: matchedSeedDates,
        items,
      };
    });
}

export function getMemoryClusters<T extends DateItem>(
  items: T[],
  todayDate: string,
  opts?: {
    seedWindowDays?: number;
    maxGapDays?: number;
    excludeYear?: number;
  },
): ResolvedMemoryCluster<T>[] {
  const seedWindowDays = opts?.seedWindowDays ?? 14;
  const maxGapDays = opts?.maxGapDays ?? 3;
  const excludeYear = opts?.excludeYear ?? parseDateParts(todayDate).year;
  const itemsByYear = new Map<number, T[]>();

  items.forEach((item) => {
    const year = parseDateParts(item.date).year;
    if (!Number.isFinite(year) || year === excludeYear) {
      return;
    }

    const current = itemsByYear.get(year) ?? [];
    current.push(item);
    itemsByYear.set(year, current);
  });

  return Array.from(itemsByYear.entries())
    .sort((left, right) => right[0] - left[0])
    .flatMap(([year, yearItems]) => {
      const seedDates = new Set(
        yearItems
          .map((item) => item.date)
          .filter(
            (date, index, dates) =>
              dates.indexOf(date) === index &&
              getCircularDayDistance(date, todayDate) <= seedWindowDays,
          ),
      );

      return findClustersAroundSeeds(yearItems, seedDates, maxGapDays).map(
        (cluster) => ({
          year,
          yearsAgo: excludeYear - year,
          startDate: cluster.startDate,
          endDate: cluster.endDate,
          items: cluster.items,
        }),
      );
    })
    .sort((left, right) => right.startDate.localeCompare(left.startDate));
}

const formatMonthDay = (date: string) => {
  const { month, day } = parseDateParts(date);
  return `${MONTH_LABELS[month - 1]} ${day}`;
};

export const formatMemoryDateRange = (startDate: string, endDate: string) => {
  const { year: startYear } = parseDateParts(startDate);

  if (startDate === endDate) {
    return `${formatMonthDay(startDate)}, ${startYear}`;
  }

  const start = parseDateParts(startDate);
  const end = parseDateParts(endDate);

  if (start.month === end.month) {
    return `${MONTH_LABELS[start.month - 1]} ${start.day} - ${end.day}, ${startYear}`;
  }

  return `${formatMonthDay(startDate)} - ${formatMonthDay(endDate)}, ${startYear}`;
};
