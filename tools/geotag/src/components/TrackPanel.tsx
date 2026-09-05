import { useEffect, useMemo, useRef, useState } from "react";
import type { Track } from "@shared/gpsTrack";
import type { ResolvedOffset } from "@shared/gpsOffset";
import { parseExifOffset } from "@shared/gpsOffset";
import { formatOffsetMinutes, type GeotagPhoto, type PendingFix } from "../api.ts";
import {
  interpolatePhotos,
  parseTrackFile,
  suggestSegmentOffset,
  trackFormatFor,
} from "../interpolate.ts";

const fmtSpan = (track: Track): string => {
  if (track.points.length === 0) return "";
  const start = new Date(track.points[0].utcMs).toISOString().slice(0, 16).replace("T", " ");
  const end = new Date(track.points[track.points.length - 1].utcMs)
    .toISOString()
    .slice(0, 16)
    .replace("T", " ");
  return `${start} → ${end} UTC`;
};

export const TrackPanel = ({
  photos,
  onTrack,
  onInterpolated,
  disabled = false,
}: {
  photos: GeotagPhoto[];
  onTrack: (track: Track | null) => void;
  onInterpolated: (fixes: Record<string, PendingFix>) => void;
  disabled?: boolean;
}) => {
  const [track, setTrack] = useState<Track | null>(null);
  const [offsetStr, setOffsetStr] = useState("+00:00");
  const [offsetMode, setOffsetMode] = useState<"camera" | "override">("camera");
  const [suggested, setSuggested] = useState<ResolvedOffset | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const loadGeneration = useRef(0);
  useEffect(
    () => () => {
      loadGeneration.current += 1;
    },
    [],
  );
  const offset = parseExifOffset(offsetStr);
  const matches = useMemo(
    () => (track && offset !== null ? interpolatePhotos(photos, track, offset, offsetMode) : {}),
    [photos, track, offset, offsetMode],
  );
  const matchCount = Object.keys(matches).length;

  const loadFile = async (file: File) => {
    const generation = ++loadGeneration.current;
    setBusy(true);
    setErr(null);
    try {
      const text = await file.text();
      if (loadGeneration.current !== generation) return;
      const parsed = parseTrackFile(text, trackFormatFor(file.name));
      if (parsed.points.length === 0) {
        setErr("No track points found in that file.");
        return;
      }
      setTrack(parsed);
      onTrack(parsed);
      const s = await suggestSegmentOffset(photos, parsed);
      if (loadGeneration.current !== generation) return;
      setSuggested(s);
      if (s) setOffsetStr(formatOffsetMinutes(s.offsetMinutes));
    } catch (e) {
      if (loadGeneration.current === generation) setErr(String(e));
    } finally {
      if (loadGeneration.current === generation) setBusy(false);
    }
  };

  const doInterpolate = () => {
    if (!track) return;
    if (offset === null) {
      setErr("Offset must look like +09:00 or -05:30.");
      return;
    }
    setErr(null);
    if (matchCount === 0) {
      setErr("No photos fall within the track's time span at this offset.");
    }
    onInterpolated(matches);
  };

  const clearTrack = () => {
    loadGeneration.current += 1;
    setBusy(false);
    setTrack(null);
    setSuggested(null);
    onTrack(null);
  };

  return (
    <div className="trackPanel">
      <label className="fileBtn">
        {busy ? "Reading…" : "Load GPX / Takeout…"}
        <input
          type="file"
          disabled={disabled}
          accept=".gpx,.json"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) loadFile(f);
            e.target.value = "";
          }}
        />
      </label>

      {track ? (
        <>
          <span className="stat">
            {track.points.length} pts · {fmtSpan(track)}
          </span>
          <label className="offsetField">
            Offset source
            <select
              value={offsetMode}
              onChange={(event) => setOffsetMode(event.target.value as "camera" | "override")}
              disabled={busy || disabled}
            >
              <option value="camera">Use camera offsets</option>
              <option value="override">Override camera offsets</option>
            </select>
          </label>
          <label className="offsetField">
            Offset
            <input
              className="coords coords--sm"
              value={offsetStr}
              onChange={(e) => setOffsetStr(e.target.value)}
              disabled={busy || disabled}
            />
          </label>
          <span className="toolbar__hint">
            {offsetMode === "camera"
              ? "Entered offset applies only where the camera has none. "
              : "Entered offset applies to every photo. "}
            {suggested
              ? `suggested ${formatOffsetMinutes(suggested.offsetMinutes)} (${suggested.source})`
              : "no suggestion — set the camera's UTC offset manually"}
          </span>
          <button
            className="primary"
            onClick={doInterpolate}
            disabled={busy || disabled || !matchCount}
          >
            Interpolate album
          </button>
          {offset === null ? (
            <span role="alert">Offset must look like +09:00 or -05:30.</span>
          ) : (
            <details>
              <summary>
                {matchCount} / {photos.length} photos matched
              </summary>
              <table aria-label="Track matches">
                <thead>
                  <tr>
                    <th>Photo</th>
                    <th>Coordinates</th>
                    <th>Confidence</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(matches).map(([filename, fix]) => (
                    <tr key={filename}>
                      <td>{filename}</td>
                      <td>
                        {fix.lat.toFixed(5)}, {fix.lng.toFixed(5)}
                      </td>
                      <td>{fix.confidence}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
          )}
          <button onClick={clearTrack} disabled={disabled}>
            Clear track
          </button>
        </>
      ) : (
        <span className="toolbar__hint">
          Load a GPS track to interpolate positions by capture time.
        </span>
      )}
      {err ? <span className="error">{err}</span> : null}
    </div>
  );
};
