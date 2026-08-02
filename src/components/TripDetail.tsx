import { AppLink as Link } from "./platform";
import type { Trip } from "../util/computeTrips";
import { formatExifWallClockDate } from "../util/exifTime";
import { Caption, Heading, Thumb } from "./ui";
import styles from "./TripDetail.module.css";

/** The shooting-window sparkline spans a waking day; earlier hours are rare. */
const FIRST_HOUR = 5;
const LAST_HOUR = 23;
/** Below this an overnight move is a walk, not a change of base. */
const NOTABLE_MOVE_KM = 20;

const longDate = (iso: string) => formatExifWallClockDate(`${iso}T00:00:00`) ?? iso;

const roundKm = (km: number) => (km >= 10 ? Math.round(km) : Math.round(km * 10) / 10);

/**
 * One journey, day by day.
 *
 * Shared by the album's Trips view and the /trips page so the two cannot drift.
 * Everything shown is derived from the photographs themselves: the colour bar
 * is the day's average dominant colour, the sparkline the hours it was shot in,
 * and the two distances answer different questions — how far the day's centre
 * of gravity moved overnight, and how much ground was covered once there.
 */
export const TripDetail = ({ trip, headingLevel = 2 }: { trip: Trip; headingLevel?: 2 | 3 }) => (
  <section className={styles.trip}>
    <div className={styles.head}>
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
      {trip.places.length > 0 ? (
        <p className={styles.places}>{trip.places.slice(0, 8).join(" → ")}</p>
      ) : null}
      {trip.firstVisits.length > 0 ? (
        <p className={styles.firsts}>
          First time in {trip.firstVisits.slice(0, 6).join(", ")}
          {trip.firstVisits.length > 6 ? ` and ${trip.firstVisits.length - 6} more` : ""}
        </p>
      ) : null}
    </div>

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
          {day.colour ? (
            <div
              className={styles.colour}
              style={{ backgroundColor: day.colour }}
              title="The day's average colour"
              aria-hidden="true"
            />
          ) : null}
        </div>

        <div className={styles.strip}>
          {day.photos.map((photo) => (
            <Link key={photo.href + photo.src} href={photo.href}>
              <Thumb
                src={photo.src}
                alt={photo.label}
                size="small"
                loading="lazy"
                {...(photo.swatch ? { style: { backgroundColor: photo.swatch } } : {})}
              />
            </Link>
          ))}
        </div>
      </div>
    ))}
  </section>
);
