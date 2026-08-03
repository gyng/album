import React from "react";
import { AppLink as Link, useClientComponents } from "./platform";
import type { Trip } from "../util/computeTrips";
import { formatExifWallClockDate } from "../util/exifTime";
import { Caption, Heading, PillButton, Thumb } from "./ui";
import styles from "./TripDetail.module.css";

/** The shooting-window sparkline spans a waking day; earlier hours are rare. */
const FIRST_HOUR = 5;
const LAST_HOUR = 23;
/** Below this an overnight move is a walk, not a change of base. */
const NOTABLE_MOVE_KM = 20;

const longDate = (iso: string) => formatExifWallClockDate(`${iso}T00:00:00`) ?? iso;

const roundKm = (km: number) => (km >= 10 ? Math.round(km) : Math.round(km * 10) / 10);

/** Enough of a trip to be worth naming; below it, a stray frame. */
const MIN_GEAR_SHARE = 0.02;
const MAX_GEAR_ENTRIES = 4;

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
        {items
          .filter((item) => item.count / total >= MIN_GEAR_SHARE)
          .slice(0, MAX_GEAR_ENTRIES)
          .map((item) => (
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
 * One journey, day by day.
 *
 * Shared by the album's Trips view and the /trips page so the two cannot drift.
 * Everything shown is derived from the photographs themselves: the dot is the
 * day's average dominant colour, the sparkline the hours it was shot in, and
 * the two distances answer different questions — how far the day's centre of
 * gravity moved overnight, and how much ground was covered once there.
 */
/**
 * A trip's route, loaded only when asked for.
 *
 * /trips lists every journey in the archive, and a map per trip would build
 * scores of WebGL contexts on one page — so the map is a disclosure, not part
 * of the layout. Nothing about MapLibre is even fetched until a reader opens
 * one.
 */
const OpenedRoute = ({ trip }: { trip: Trip }) => {
  const { TripRouteMap } = useClientComponents();
  return <TripRouteMap trip={trip} />;
};

const RouteDisclosure = ({ trip }: { trip: Trip }) => {
  const [open, setOpen] = React.useState(false);

  if (!trip.days.some((day) => day.point)) {
    return null;
  }

  return (
    <div className={styles.route}>
      <PillButton
        variant="ghost"
        onClick={() => setOpen((wasOpen) => !wasOpen)}
        aria-expanded={open}
      >
        {open ? "Hide route" : "Show route"}
      </PillButton>
      {/* The deferred-component registry is only consulted once a reader opens
          a route, so a renderer that installs no provider — an album page in a
          bare test, say — still renders the trip. */}
      {open ? <OpenedRoute trip={trip} /> : null}
    </div>
  );
};

export const TripDetail = ({ trip, headingLevel = 2 }: { trip: Trip; headingLevel?: 2 | 3 }) => (
  <section className={styles.trip}>
    <div className={styles.head}>
      {/* Heading beside its caption on one baseline, as every other section
          header on this site is set. */}
      <div className={styles.headRow}>
        <Heading level={headingLevel} as={headingLevel === 2 ? "h2" : "h3"}>
          {trip.isOuting
            ? longDate(trip.startDate)
            : `${longDate(trip.startDate)} – ${longDate(trip.endDate)}`}
        </Heading>
        <Caption as="span">
          {trip.isOuting
            ? `outing · ${trip.photoCount.toLocaleString("en")} photos`
            : `${trip.dayCount} days · ${trip.photoCount.toLocaleString("en")} photos`}
          {trip.totalKm && trip.totalKm >= 1 ? ` · ${roundKm(trip.totalKm)} km` : ""}
          {trip.albums.length > 1 ? ` · from ${trip.albums.join(" and ")}` : ""}
        </Caption>
      </div>
      {trip.places.length > 0 ? (
        <p className={styles.places}>{trip.places.slice(0, 8).join(" → ")}</p>
      ) : null}
      {trip.firstVisits.length > 0 ? (
        <p className={styles.firsts}>
          First time in {trip.firstVisits.slice(0, 6).join(", ")}
          {trip.firstVisits.length > 6 ? ` and ${trip.firstVisits.length - 6} more` : ""}
        </p>
      ) : null}
      {trip.laterReturns.length > 0 ? (
        <p className={styles.returns}>
          Came back:{" "}
          {trip.laterReturns
            .slice(0, 4)
            .map((entry) => `${entry.place} in ${entry.year}`)
            .join(", ")}
          {trip.laterReturns.length > 4 ? ` and ${trip.laterReturns.length - 4} more` : ""}
        </p>
      ) : null}

      {trip.distinctiveTags.length > 0 ? (
        <div className={styles.panel}>
          {/* A count would only report that a long trip is long. The multiplier
              is the fact: how much likelier this subject was here than in the
              archive around it. */}
          <p className={styles.panelTitle}>Shot here more than you usually do</p>
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

      {trip.gear.photosWithCamera > 0 ? (
        <div className={styles.panel}>
          <p className={styles.panelTitle}>What you carried</p>
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
      <RouteDisclosure trip={trip} />
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
            {trip.isOuting ? null : <p className={styles.dayno}>Day {index + 1}</p>}
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
              {day.coveredKm && day.coveredKm >= 1 ? ` · ${roundKm(day.coveredKm)} km covered` : ""}
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

          <div className={styles.strip}>
            {day.photos.map((photo) => (
              <Link key={photo.href + photo.src} href={photo.href}>
                <Thumb
                  src={photo.src}
                  alt={photo.label}
                  loading="lazy"
                  {...(photo.swatch ? { style: { backgroundColor: photo.swatch } } : {})}
                />
              </Link>
            ))}
          </div>
        </div>
      ))}
    </div>
  </section>
);
