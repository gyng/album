import React from "react";
import { AppLink as Link, useClientComponents } from "./platform";
import type { Trip, TripDay } from "../util/computeTrips";
import { formatExifWallClockDate } from "../util/exifTime";
import { Caption, Heading, Thumb } from "./ui";
import { TripRoutePath } from "./TripRoutePath";
import { useNearViewport } from "./useNearViewport";
import styles from "./TripDetail.module.css";

/** The shooting-window sparkline spans a waking day; earlier hours are rare. */
const FIRST_HOUR = 5;
const LAST_HOUR = 23;
/** Below this an overnight move is a walk, not a change of base. */
const NOTABLE_MOVE_KM = 20;

const longDate = (iso: string) => formatExifWallClockDate(`${iso}T00:00:00`) ?? iso;

const roundKm = (km: number) => (km >= 10 ? Math.round(km) : Math.round(km * 10) / 10);

/**
 * Every body and lens a trip used, to a limit.
 *
 * No minimum share: one frame on a borrowed lens is a fact about the trip, and
 * the kit is short enough to list — this is not a long tail that needs cutting.
 */
const MAX_GEAR_ENTRIES = 5;

const share = (count: number, total: number) => Math.round((count / total) * 100);

/**
 * One row of "what you carried".
 *
 * Bodies are measured against the frames that recorded a body and lenses
 * against the frames that recorded a *lens*, which is not the same number:
 * a fixed-lens body writes no LensModel at all, and half this archive is one.
 * Measuring lenses against the whole trip would quietly claim frames no lens
 * can account for.
 */
const GearList = ({
  title,
  items,
  total,
  note,
}: {
  title: string;
  items: Array<{ name: string; count: number }>;
  total: number;
  note?: string;
}) =>
  items.length === 0 || total === 0 ? null : (
    <div className={styles.gearGroup}>
      <p className={styles.gearTitle}>{title}</p>
      <ul className={styles.gearList}>
        {items.slice(0, MAX_GEAR_ENTRIES).map((item) => (
          <li key={item.name} className={styles.gearItem}>
            <span className={styles.gearName}>{item.name}</span>
            <span className={styles.gearShare}>{share(item.count, total)}%</span>
          </li>
        ))}
      </ul>
      {note ? <p className={styles.gearNote}>{note}</p> : null}
    </div>
  );

/**
 * What the trip was shot with, and what it was unusually full of.
 *
 * Folded away by default. Open, these were two more rows in a header that
 * already carried five at the same weight, and a reader looking for the
 * journey had to read past its equipment list to reach it.
 */
const TripFacts = ({ trip }: { trip: Trip }) => {
  const hasGear = trip.gear.photosWithCamera > 0;
  const hasTags = trip.distinctiveTags.length > 0;
  if (!hasGear && !hasTags) return null;

  return (
    <div className={styles.factsBody}>
      {hasTags ? (
        <div className={styles.panel}>
          {/* A count would only report that a long trip is long. The multiplier
                is the fact: how much likelier this subject was here than in the
                archive around it. */}
          <p className={styles.panelTitle}>Unusual here</p>
          <ul className={styles.tagList}>
            {trip.distinctiveTags.map((entry) => (
              <li key={entry.tag} className={styles.tag}>
                <span className={styles.tagName}>{entry.tag}</span>
                <span className={styles.tagTimes}>{entry.times}×</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {hasGear ? (
        <div className={styles.panel}>
          <p className={styles.panelTitle}>Kit</p>
          <div className={styles.gear}>
            <GearList title="Bodies" items={trip.gear.cameras} total={trip.gear.photosWithCamera} />
            <GearList
              title="Lenses"
              items={trip.gear.lenses}
              total={trip.gear.photosWithLens}
              {...(trip.gear.photosWithLens < trip.photoCount
                ? {
                    note: `of the ${trip.gear.photosWithLens} of ${trip.photoCount} frames that recorded one`,
                  }
                : {})}
            />
          </div>
        </div>
      ) : null}
    </div>
  );
};

/**
 * Far enough ahead that the basemap is up before the trip is on screen.
 *
 * Roughly two screens on a laptop: a map that starts loading as its trip
 * arrives is a map the reader watches load.
 */
const ROUTE_PREFETCH_MARGIN = "1600px 0px";

/**
 * A trip's route: drawn immediately, mapped once the reader is near it.
 *
 * The drawing costs nothing and renders with the page, so a trip is never a
 * blank column. The map replaces it as the trip approaches the viewport, and
 * gives it up again when it leaves — a page listing ninety-four journeys cannot
 * hold ninety-four WebGL contexts. Its basemap is the keyless one, so the
 * number of trips a reader scrolls past is not a bill.
 */
const MappedRoute = ({
  trip,
  activeDate,
  onReady,
}: {
  trip: Trip;
  activeDate: string | null;
  onReady: () => void;
}) => {
  const { TripRouteMap } = useClientComponents();
  return <TripRouteMap trip={trip} activeDate={activeDate} onReady={onReady} />;
};

const TripRoute = ({ trip, activeDate }: { trip: Trip; activeDate: string | null }) => {
  const ref = React.useRef<HTMLDivElement>(null);
  // False where the browser cannot observe: with no way to tell which trips are
  // on screen, ninety-four maps at once is worse than the drawing everywhere.
  const near = useNearViewport(ref, ROUTE_PREFETCH_MARGIN, false);
  const [mapped, setMapped] = React.useState(false);

  // A map that has gone gives its place back to the drawing, so scrolling away
  // and back does not leave an empty box behind.
  React.useEffect(() => {
    if (!near) setMapped(false);
  }, [near]);

  if (!trip.days.some((day) => day.point)) return null;

  return (
    <div ref={ref} className={styles.side}>
      {/* The drawing stays underneath until the map has actually drawn. The two
          used to swap: the line vanished, a grey box took its place, and the
          basemap faded up inside it — three states where the reader wanted
          one. */}
      <div className={styles.routeStack} data-mapped={mapped}>
        <div className={styles.routeDrawing} aria-hidden={mapped ? true : undefined}>
          <TripRoutePath trip={trip} activeDate={activeDate} />
        </div>

        {/* The registry is consulted only once a map is actually wanted, so a
            renderer that installs no provider still draws the trip. */}
        {near ? (
          <div className={styles.routeMap}>
            <MappedRoute
              trip={trip}
              activeDate={activeDate}
              onReady={() => {
                setMapped(true);
              }}
            />
          </div>
        ) : null}
      </div>
    </div>
  );
};

/** Every frame of a day. */
const DayStrip = ({
  day,
  onPoint,
}: {
  day: TripDay;
  onPoint?: { enter: () => void; leave: () => void };
}) => {
  return (
    <div
      className={styles.strip}
      {...(onPoint ? { onMouseEnter: onPoint.enter, onMouseLeave: onPoint.leave } : {})}
    >
      {day.photos.map((photo) => (
        <Link key={photo.href + photo.src} className={styles.frame} href={photo.href}>
          <Thumb
            src={photo.src}
            alt={photo.label}
            loading="lazy"
            {...(photo.swatch ? { style: { backgroundColor: photo.swatch } } : {})}
          />
        </Link>
      ))}
    </div>
  );
};

/**
 * One journey, day by day.
 *
 * Shared by the album's Trips view and the /trips page so the two cannot drift.
 * Everything shown is derived from the photographs themselves: the dot is the
 * day's average dominant colour, the sparkline the hours it was shot in, and
 * the two distances answer different questions — how far the day's centre of
 * gravity moved overnight, and how much ground was covered once there.
 *
 * A single-day outing is rendered as one compact row instead. There are 58 of
 * them against 36 journeys, and given the full apparatus each one repeated its
 * own date twice, drew a rail with a single dot and opened a map on one pin.
 */
export const TripDetail = ({ trip, headingLevel = 2 }: { trip: Trip; headingLevel?: 2 | 3 }) => {
  // Which day the reader is pointing at, so its marker can come to the front of
  // a map where markers necessarily overlap.
  const [activeDate, setActiveDate] = React.useState<string | null>(null);
  const only = trip.days[0];

  if (trip.isOuting && only) {
    return (
      <section className={[styles.trip, styles.outing].filter(Boolean).join(" ")}>
        <div className={styles.head}>
          <div className={styles.headRow}>
            <Heading level={headingLevel} as={headingLevel === 2 ? "h2" : "h3"}>
              {longDate(trip.startDate)}
            </Heading>
            <Caption as="span">
              {trip.photoCount.toLocaleString("en")} photos
              {only.from ? ` · ${only.from}–${only.to}` : ""}
              {trip.totalKm && trip.totalKm >= 1 ? ` · ${roundKm(trip.totalKm)} km` : ""}
              {trip.albums.length > 1 ? ` · from ${trip.albums.join(" and ")}` : ""}
            </Caption>
          </div>
          {trip.places.length > 0 ? (
            <p className={styles.places}>{trip.places.slice(0, 8).join(" → ")}</p>
          ) : null}
          {trip.firstVisits.length > 0 ? (
            <p className={styles.firsts}>First time in {trip.firstVisits.slice(0, 6).join(", ")}</p>
          ) : null}
          <TripFacts trip={trip} />
        </div>

        <DayStrip day={only} />

        <TripRoute trip={trip} activeDate={activeDate} />
      </section>
    );
  }

  return (
    <section className={styles.trip}>
      <div className={styles.head}>
        {/* Heading beside its caption on one baseline, as every other section
          header on this site is set. */}
        <div className={styles.headRow}>
          <Heading level={headingLevel} as={headingLevel === 2 ? "h2" : "h3"}>
            {`${longDate(trip.startDate)} – ${longDate(trip.endDate)}`}
          </Heading>
          <Caption as="span">
            {`${trip.dayCount} days · ${trip.photoCount.toLocaleString("en")} photos`}
            {trip.totalKm && trip.totalKm >= 1 ? ` · ${roundKm(trip.totalKm)} km` : ""}
            {trip.albums.length > 1 ? ` · from ${trip.albums.join(" and ")}` : ""}
          </Caption>
        </div>
        {trip.places.length > 0 ? (
          <p className={styles.places}>{trip.places.slice(0, 8).join(" → ")}</p>
        ) : null}
        {trip.firstVisits.length > 0 || trip.laterReturns.length > 0 ? (
          <p className={styles.visits}>
            {trip.firstVisits.length > 0 ? (
              <span className={styles.firsts}>
                First time in {trip.firstVisits.slice(0, 6).join(", ")}
                {trip.firstVisits.length > 6 ? ` and ${trip.firstVisits.length - 6} more` : ""}
              </span>
            ) : null}
            {trip.laterReturns.length > 0 ? (
              <span className={styles.returns}>
                Came back:{" "}
                {trip.laterReturns
                  .slice(0, 4)
                  .map((entry) => `${entry.place} in ${entry.year}`)
                  .join(", ")}
                {trip.laterReturns.length > 4 ? ` and ${trip.laterReturns.length - 4} more` : ""}
              </span>
            ) : null}
          </p>
        ) : null}

        <TripFacts trip={trip} />
      </div>

      <div className={styles.days}>
        {trip.days.map((day, index) => (
          <div key={day.date} className={styles.day}>
            <div className={styles.rail} aria-hidden="true">
              <span className={styles.dot} />
              {day.movedKm && day.movedKm >= NOTABLE_MOVE_KM ? (
                <span className={styles.moved}>{Math.round(day.movedKm)} km</span>
              ) : null}
            </div>

            <div className={styles.meta}>
              <p className={styles.dayno}>Day {index + 1}</p>
              <p className={styles.date}>{longDate(day.date)}</p>
              {day.places.length > 0 ? (
                <p className={styles.places}>{day.places.slice(0, 5).join(" → ")}</p>
              ) : null}
              <p className={styles.stat}>
                {day.colour ? (
                  <span
                    className={styles.swatch}
                    style={{ background: day.colour }}
                    title="The day's average colour"
                    aria-hidden="true"
                  />
                ) : null}
                {day.count.toLocaleString("en")} {day.count === 1 ? "photo" : "photos"}
                {day.from ? ` · ${day.from}–${day.to}` : ""}
                {day.coveredKm && day.coveredKm >= 1
                  ? ` · ${roundKm(day.coveredKm)} km covered`
                  : ""}
              </p>
              {day.hours.length > 0 ? (
                <div
                  className={styles.hours}
                  aria-hidden="true"
                  title={`Photographed between ${day.from} and ${day.to}`}
                >
                  {Array.from({ length: LAST_HOUR - FIRST_HOUR + 1 }, (_, offset) => (
                    <span
                      key={offset}
                      className={day.hours.includes(FIRST_HOUR + offset) ? styles.on : styles.off}
                    />
                  ))}
                </div>
              ) : null}
            </div>

            <DayStrip
              day={day}
              onPoint={{ enter: () => setActiveDate(day.date), leave: () => setActiveDate(null) }}
            />
          </div>
        ))}
      </div>

      <TripRoute trip={trip} activeDate={activeDate} />
    </section>
  );
};
