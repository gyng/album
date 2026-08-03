import React from "react";
import { AppLink as Link, useClientComponents } from "./platform";
import type { Trip, TripDay } from "../util/computeTrips";
import { formatExifWallClockDate } from "../util/exifTime";
import { Caption, Heading, Thumb } from "./ui";
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

/**
 * How tall a trip's map is, in the column beside it.
 *
 * A fortnight and an afternoon are not the same amount of map: a fixed height
 * left a hundred and thirty-eight pixels of empty column under the short ones
 * while a fourteen-day route was cramped.
 */
const MAP_HEIGHT_BASE_PX = 220;
const MAP_HEIGHT_PER_DAY_PX = 22;
const MAP_HEIGHT_MAX_PX = 460;

const mapHeightPx = (trip: Trip) =>
  Math.min(MAP_HEIGHT_MAX_PX, MAP_HEIGHT_BASE_PX + trip.dayCount * MAP_HEIGHT_PER_DAY_PX);

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
 * Far enough ahead that the map has fetched its script, style and first tiles
 * before the trip is on screen. A map that starts loading as it arrives lands
 * mid-scroll, which is exactly when the jank shows.
 */
const ROUTE_PREFETCH_MARGIN = "1400px 0px";

/**
 * A trip's route, alongside the trip.
 *
 * Mounted only while the trip is near the viewport, and unmounted again when it
 * leaves. That gate is what makes a map per trip affordable at all: the list
 * grows to every journey in the archive, and each live map holds a WebGL
 * context the browser will not hand out indefinitely.
 */
const RouteColumn = ({ trip, activeDate }: { trip: Trip; activeDate: string | null }) => {
  const ref = React.useRef<HTMLDivElement>(null);
  const near = useNearViewport(ref, ROUTE_PREFETCH_MARGIN);
  const { TripRouteMap } = useClientComponents();

  return (
    <div ref={ref} className={styles.side} style={{ blockSize: `${mapHeightPx(trip)}px` }}>
      {near ? <TripRouteMap trip={trip} activeDate={activeDate} /> : null}
    </div>
  );
};

/**
 * Only trips that can be drawn get a map, so a trip whose photographs never
 * recorded where they were keeps the full width for its frames. An outing gets
 * one too — shorter, since a single day needs less of it.
 */
const TripRoute = ({ trip, activeDate }: { trip: Trip; activeDate: string | null }) =>
  trip.days.some((day) => day.point) ? <RouteColumn trip={trip} activeDate={activeDate} /> : null;

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
