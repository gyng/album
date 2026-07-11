import { useState } from "react";
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
}: {
  photos: GeotagPhoto[];
  onTrack: (track: Track | null) => void;
  onInterpolated: (fixes: Record<string, PendingFix>) => void;
}) => {
  const [track, setTrack] = useState<Track | null>(null);
  const [offsetStr, setOffsetStr] = useState("+00:00");
  const [suggested, setSuggested] = useState<ResolvedOffset | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const loadFile = async (file: File) => {
    setBusy(true);
    setErr(null);
    try {
      const text = await file.text();
      const parsed = parseTrackFile(text, trackFormatFor(file.name));
      if (parsed.points.length === 0) {
        setErr("No track points found in that file.");
        return;
      }
      setTrack(parsed);
      onTrack(parsed);
      const s = await suggestSegmentOffset(photos, parsed);
      setSuggested(s);
      if (s) setOffsetStr(formatOffsetMinutes(s.offsetMinutes));
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  };

  const doInterpolate = () => {
    if (!track) return;
    const offset = parseExifOffset(offsetStr);
    if (offset === null) {
      setErr("Offset must look like +09:00 or -05:30.");
      return;
    }
    setErr(null);
    const fixes = interpolatePhotos(photos, track, offset);
    if (Object.keys(fixes).length === 0) {
      setErr("No photos fall within the track's time span at this offset.");
    }
    onInterpolated(fixes);
  };

  const clearTrack = () => {
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
            Offset
            <input
              className="coords coords--sm"
              value={offsetStr}
              onChange={(e) => setOffsetStr(e.target.value)}
            />
          </label>
          <span className="toolbar__hint">
            {suggested
              ? `suggested ${formatOffsetMinutes(suggested.offsetMinutes)} (${suggested.source})`
              : "no suggestion — set the camera's UTC offset manually"}
          </span>
          <button className="primary" onClick={doInterpolate} disabled={busy}>
            Interpolate album
          </button>
          <button onClick={clearTrack}>Clear track</button>
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
