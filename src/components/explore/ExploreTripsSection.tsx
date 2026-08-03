import { AppLink as Link } from "../platform";
import { mergeCssModuleStyles } from "../../util/mergeCssModuleStyles";
import type { TripSummary } from "../../util/computeTrips";
import { Caption, Heading, pillStyles } from "../ui";
import sharedStyles from "./ExploreShared.module.css";
import localStyles from "./ExploreTripsSection.module.css";

const styles = mergeCssModuleStyles(sharedStyles, localStyles, ["tripBig", "tripLead"], []);

/**
 * That the archive contains journeys is a fact about it, so it belongs here.
 * Browsing them is not — that lives on the timeline, between the heatmap and
 * the day view, where a trip is a way in rather than a statistic.
 */
export const ExploreTripsSection = ({ trips }: { trips: TripSummary[] }) => {
  if (trips.length === 0) return null;

  const journeys = trips.filter((trip) => !trip.isOuting);
  const longest = journeys.reduce(
    (best, trip) => (trip.dayCount > (best?.dayCount ?? 0) ? trip : best),
    journeys[0],
  );

  return (
    <section className={styles.section}>
      <div className={styles.sectionHeader}>
        <Heading level={2} as="h2">
          Trips
        </Heading>
        <Caption as="span">Grouped from the photographs themselves</Caption>
      </div>
      <p className={styles.tripBig}>
        {journeys.length}
        <span>
          {" "}
          {journeys.length === 1 ? "journey" : "journeys"} and {trips.length - journeys.length}{" "}
          single-day outings
        </span>
      </p>
      {longest ? (
        <p className={styles.tripLead}>
          The longest ran {longest.dayCount} days across {longest.places.slice(0, 3).join(", ")}.
        </p>
      ) : null}
      <Link href="/trips" className={`${pillStyles.base} ${pillStyles.ghost}`}>
        <span>Browse every trip</span>
        <span aria-hidden="true">↗</span>
      </Link>
    </section>
  );
};
