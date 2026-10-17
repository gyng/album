"""Best-effort, cached Open-Meteo enrichment; no model runtime required."""

import json
import math
import sqlite3
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import UTC, datetime, timedelta

VERSION = 1
VARIABLES = (
    "temperature_2m",
    "apparent_temperature",
    "relative_humidity_2m",
    "precipitation",
    "cloud_cover",
    "wind_speed_10m",
    "weather_code",
    "snowfall",
)


def sample_hour(local_time, offset):
    """Convert a camera wall clock to the true UTC hour using its derived zone."""
    if not local_time or not offset:
        return None
    try:
        local = datetime.fromisoformat(local_time)
        if local.tzinfo is not None:
            return None
        instant = datetime.fromisoformat(local_time + offset).astimezone(UTC)
        return instant.replace(minute=0, second=0, microsecond=0)
    except ValueError:
        return None


def request_spec(lat, lon, hour, now):
    if not all(isinstance(n, (int, float)) and math.isfinite(n) for n in (lat, lon)):
        return None
    if not (-90 <= lat <= 90 and -180 <= lon <= 180) or not hour:
        return None
    if hour > now or hour.year < 1940:
        return None
    model = "era5" if hour < now - timedelta(days=7) else "ecmwf_ifs"
    day = hour.strftime("%Y-%m-%d")
    params = {
        "latitude": lat,
        "longitude": lon,
        "start_date": day,
        "end_date": day,
        "hourly": ",".join(VARIABLES),
        "timezone": "UTC",
        "models": model,
        "temperature_unit": "celsius",
        "wind_speed_unit": "kmh",
        "precipitation_unit": "mm",
    }
    key = json.dumps([VERSION, lat, lon, day, model], separators=(",", ":"))
    return (
        key,
        "https://archive-api.open-meteo.com/v1/archive?"
        + urllib.parse.urlencode(params),
        model,
    )


def extract_sample(response, hour, lat, lon, model, now):
    hourly = response.get("hourly", {})
    if not isinstance(hourly, dict):
        return None
    times = hourly.get("time", [])
    target = hour.strftime("%Y-%m-%dT%H:00")
    if not isinstance(times, list) or target not in times:
        return None
    i = times.index(target)
    values = {}
    for variable in VARIABLES:
        series = hourly.get(variable, [])
        value = series[i] if isinstance(series, list) and i < len(series) else None
        values[variable] = (
            value
            if isinstance(value, (int, float))
            and not isinstance(value, bool)
            and math.isfinite(value)
            else None
        )
    if values["temperature_2m"] is None or values["weather_code"] is None:
        return None
    return dict(
        version=VERSION,
        source="open-meteo",
        model=model,
        sampled_at=target + ":00Z",
        fetched_at=now.isoformat(),
        latitude=lat,
        longitude=lon,
        grid_latitude=response.get("latitude"),
        grid_longitude=response.get("longitude"),
        **values,
    )


def fetch_json(url):
    request = urllib.request.Request(
        url, headers={"User-Agent": "PhotoGalleryWeather/1.0"}
    )
    with urllib.request.urlopen(request, timeout=25) as response:
        return json.load(response)


def enrich_database(
    dbpath, interval=1.0, max_requests=2000, fetch=fetch_json, log=print, now=None
):
    now = now or datetime.now(UTC)
    con = sqlite3.connect(dbpath, timeout=30)
    columns = {r[1] for r in con.execute("PRAGMA table_info(metadata)")}
    if "weather_json" not in columns:
        con.execute("ALTER TABLE metadata ADD COLUMN weather_json TEXT")
    con.execute(
        "CREATE TABLE IF NOT EXISTS weather_cache (key TEXT PRIMARY KEY, response TEXT NOT NULL)"
    )
    con.execute(
        "CREATE TABLE IF NOT EXISTS weather_requests (requested_at REAL NOT NULL)"
    )
    con.execute(
        "CREATE INDEX IF NOT EXISTS idx_weather_requests_time ON weather_requests(requested_at)"
    )
    con.commit()
    # A clip carries the same sidecar-derived coordinates and camera-local wall
    # clock a photo carries in EXIF, so it earns an estimate on identical terms:
    # a row without a location or a time is skipped exactly as a photo's is.
    # A clip's indexed moments do not: they are for semantic search only, and
    # each one cost a request and then counted in the facets as a photograph.
    not_scene = " AND scene_of IS NULL" if "scene_of" in columns else ""
    rows = con.execute(
        "SELECT path,lat_deg,lng_deg,iso8601,tz_offset,weather_json FROM metadata "
        f"WHERE media_kind IN ('photo', 'video'){not_scene} ORDER BY path"
    ).fetchall()
    report = {
        "updated": 0,
        "existing": 0,
        "skipped": 0,
        "failed": 0,
        "requests": 0,
        "cached": 0,
    }
    last_request = 0.0
    for path, lat, lon, local_time, offset, existing in rows:
        hour = sample_hour(local_time, offset)
        spec = request_spec(lat, lon, hour, now)
        previous = None
        if existing:
            try:
                decoded = json.loads(existing)
                previous = decoded if isinstance(decoded, dict) else None
            except (ValueError, TypeError):
                pass
        same = (
            previous
            and hour
            and previous.get("latitude") == lat
            and previous.get("longitude") == lon
            and previous.get("sampled_at") == hour.strftime("%Y-%m-%dT%H:00:00Z")
        )
        if existing and not same:
            con.execute("UPDATE metadata SET weather_json=NULL WHERE path=?", (path,))
            con.commit()
        if not spec:
            report["skipped"] += 1
            continue
        key, url, model = spec
        if (
            same
            and previous.get("version") == VERSION
            and previous.get("model") == model
        ):
            report["existing"] += 1
            continue
        cached = con.execute(
            "SELECT response FROM weather_cache WHERE key=?", (key,)
        ).fetchone()
        if cached:
            response = json.loads(cached[0])
            report["cached"] += 1
        else:
            if report["requests"] >= max_requests:
                log(
                    "Weather request budget reached; remaining rows can resume next run."
                )
                break
            stamp = time.time()
            # Persistent accounting covers separate runs and failed calls too.
            limits = [(60, 500), (3600, 4500), (86400, 9000), (31 * 86400, 270000)]
            if any(
                con.execute(
                    "SELECT COUNT(*) FROM weather_requests WHERE requested_at>?",
                    (stamp - period,),
                ).fetchone()[0]
                >= limit
                for period, limit in limits
            ):
                log("Weather rate budget reached; leaving remaining rows pending.")
                break
            time.sleep(max(0, interval - (time.monotonic() - last_request)))
            con.execute("INSERT INTO weather_requests VALUES (?)", (time.time(),))
            con.commit()
            last_request = time.monotonic()
            report["requests"] += 1
            try:
                response = fetch(url)
                if not isinstance(response, dict) or not isinstance(
                    response.get("hourly"), dict
                ):
                    raise TypeError("Malformed weather response")
                con.execute(
                    "INSERT OR REPLACE INTO weather_cache VALUES (?,?)",
                    (key, json.dumps(response)),
                )
                con.commit()
            except (urllib.error.URLError, OSError, ValueError, TypeError) as err:
                report["failed"] += 1
                log(f"Weather unavailable for {path}: {err}")
                if isinstance(err, urllib.error.HTTPError) and err.code in (429, 403):
                    log(
                        "Weather service refused requests; stopping enrichment until a later run."
                    )
                    break
                continue
        weather = extract_sample(response, hour, lat, lon, model, datetime.now(UTC))
        if weather:
            con.execute(
                "UPDATE metadata SET weather_json=? WHERE path=?",
                (json.dumps(weather, separators=(",", ":")), path),
            )
            con.commit()
            report["updated"] += 1
        else:
            report["failed"] += 1
            # A partial recent day must be fetched again when it is complete.
            con.execute("DELETE FROM weather_cache WHERE key=?", (key,))
            con.commit()
        if report["updated"] and report["updated"] % 25 == 0:
            log(
                f"Weather: {report['updated']} updated, {report['requests']} requests, {report['failed']} pending failures"
            )
    con.close()
    log("Weather: " + json.dumps(report))
    return report
