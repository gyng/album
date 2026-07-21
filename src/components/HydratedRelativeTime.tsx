import { getRelativeTimeString } from "../util/time";
import { useHydrated } from "./useHydrated";

/**
 * Relative time depends on the visitor's clock. Keep server HTML and the first
 * hydration render empty, then calculate the live label after hydration.
 */
export const HydratedRelativeTime = ({
  date,
  short = false,
  trimPastSuffix = false,
}: {
  date: Date | number;
  short?: boolean;
  trimPastSuffix?: boolean;
}) => {
  const hydrated = useHydrated();
  if (!hydrated) {
    return null;
  }

  const label = getRelativeTimeString(date, { short });
  return <>{trimPastSuffix ? label?.replace(" ago", "") : label}</>;
};
