import { useCallback, useEffect, useMemo, useState } from "react";
import {
  isLocated,
  listFolder,
  parseLatLng,
  thumbUrl,
  writeGps,
  type FolderListing,
  type PendingFix,
  type WriteResult,
} from "./api.ts";
import { GeotagMap, type PendingMarker } from "./components/GeotagMap.tsx";
import { TrackPanel } from "./components/TrackPanel.tsx";
import { FolderBar } from "./components/FolderBar.tsx";
import type { Track } from "@shared/gpsTrack";

export const App = () => {
  const [listing, setListing] = useState<FolderListing | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pending, setPending] = useState<Record<string, PendingFix>>({});
  const [coordsInput, setCoordsInput] = useState("");
  const [writing, setWriting] = useState(false);
  const [results, setResults] = useState<WriteResult[] | null>(null);
  const [track, setTrack] = useState<Track | null>(null);

  const folder = listing?.path ?? "";
  const photos = useMemo(() => listing?.photos ?? [], [listing]);

  const fetchInto = useCallback((folderPath: string | undefined) => {
    setLoading(true);
    setError(null);
    return listFolder(folderPath)
      .then(setListing)
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, []);

  // Navigate to a new folder — resets all per-folder tool state.
  const navigate = useCallback(
    (folderPath?: string) => {
      setSelected(new Set());
      setPending({});
      setResults(null);
      setTrack(null);
      return fetchInto(folderPath);
    },
    [fetchInto],
  );

  useEffect(() => {
    navigate();
  }, [navigate]);

  const located = useMemo(() => photos.filter(isLocated), [photos]);
  const byName = useMemo(() => new Map(photos.map((p) => [p.filename, p])), [photos]);
  const pendingMarkers: PendingMarker[] = useMemo(
    () => Object.entries(pending).map(([filename, fix]) => ({ filename, ...fix })),
    [pending],
  );

  const toggleSelect = (filename: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(filename)) next.delete(filename);
      else next.add(filename);
      return next;
    });

  const assignToSelected = (fix: PendingFix) => {
    if (selected.size === 0) return;
    setPending((prev) => {
      const next = { ...prev };
      for (const filename of selected) next[filename] = fix;
      return next;
    });
  };

  const onMapClick = (lat: number, lng: number) => assignToSelected({ lat, lng });

  // Dragging a marker (interpolated or manual) makes it a confirmed manual fix.
  const onPendingDrag = (filename: string, lat: number, lng: number) =>
    setPending((prev) => ({ ...prev, [filename]: { lat, lng } }));

  const onInterpolated = (fixes: Record<string, PendingFix>) =>
    setPending((prev) => ({ ...prev, ...fixes }));

  const applyPasted = () => {
    const fix = parseLatLng(coordsInput);
    if (!fix) {
      setError("Could not parse coordinates — expected 'lat, lng'.");
      return;
    }
    setError(null);
    assignToSelected(fix);
    setCoordsInput("");
  };

  const clearPending = (filename: string) =>
    setPending((prev) => {
      const next = { ...prev };
      delete next[filename];
      return next;
    });

  const selectAllMissing = () =>
    setSelected(new Set(photos.filter((p) => !isLocated(p)).map((p) => p.filename)));

  const write = async () => {
    const items = Object.entries(pending)
      .map(([filename, fix]) => {
        const photo = byName.get(filename);
        return photo
          ? { filename, path: photo.path, lat: fix.lat, lng: fix.lng, interpolated: fix.interpolated }
          : null;
      })
      .filter((it): it is NonNullable<typeof it> => it !== null);
    if (items.length === 0) return;

    const ok = window.confirm(
      `Write GPS into ${items.length} original photo(s)?\n\nA "<file>_original" backup is kept beside each edited file.`,
    );
    if (!ok) return;

    setWriting(true);
    setError(null);
    try {
      const res = await writeGps(items, folder);
      setResults(res);
      const written = new Set(res.filter((r) => r.ok).map((r) => r.filename));
      setPending((prev) => {
        const next = { ...prev };
        for (const name of written) delete next[name];
        return next;
      });
      setSelected((prev) => new Set([...prev].filter((n) => !written.has(n))));
      if (written.size > 0) fetchInto(folder); // refresh photos, keep tool state
    } catch (e) {
      setError(String(e));
    } finally {
      setWriting(false);
    }
  };

  const pendingCount = pendingMarkers.length;

  return (
    <div className="app">
      <header className="topbar">
        <h1>Geotag</h1>
        <span className="stat">
          {loading ? "loading…" : `${located.length} / ${photos.length} located`}
          {pendingCount > 0 ? ` · ${pendingCount} pending` : ""}
        </span>
        {error ? <span className="error">{error}</span> : null}
      </header>

      {listing ? <FolderBar listing={listing} onOpen={navigate} /> : null}

      {photos.length > 0 ? (
        <>
          <div className="toolbar">
            <span className="stat">{selected.size} selected</span>
            <button onClick={selectAllMissing}>Select all missing</button>
            <button onClick={() => setSelected(new Set())} disabled={selected.size === 0}>
              Clear selection
            </button>
            <span className="toolbar__sep" />
            <input
              className="coords"
              placeholder="lat, lng"
              value={coordsInput}
              onChange={(e) => setCoordsInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && applyPasted()}
            />
            <button onClick={applyPasted} disabled={selected.size === 0 || !coordsInput.trim()}>
              Assign to selected
            </button>
            <span className="toolbar__hint">
              {selected.size > 0
                ? "…or click the map to place the selection."
                : "Select photos to place them."}
            </span>
            <span className="toolbar__grow" />
            <button className="primary" onClick={write} disabled={pendingCount === 0 || writing}>
              {writing ? "Writing…" : `Write ${pendingCount} location${pendingCount === 1 ? "" : "s"}`}
            </button>
          </div>
          <TrackPanel photos={photos} onTrack={setTrack} onInterpolated={onInterpolated} />
        </>
      ) : null}

      <main className="layout">
        <section className="mapPane">
          <GeotagMap
            located={located}
            pending={pendingMarkers}
            track={track}
            canPlace={selected.size > 0}
            onMapClick={onMapClick}
            onPendingDrag={onPendingDrag}
          />
        </section>
        <section className="filmstrip">
          {loading ? (
            <p className="hint">Loading…</p>
          ) : photos.length === 0 ? (
            <p className="hint">
              No photos in this folder. Use the bar above to open one (or click a sub-folder).
            </p>
          ) : (
            photos.map((p) => {
              const fix = pending[p.filename];
              const located_ = isLocated(p);
              return (
                <figure
                  key={p.filename}
                  className={[
                    "card",
                    selected.has(p.filename) ? "card--selected" : "",
                    fix ? "card--pending" : located_ ? "card--located" : "card--missing",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  onClick={() => toggleSelect(p.filename)}
                >
                  <img src={thumbUrl(p.path, 200)} alt={p.filename} loading="lazy" />
                  <figcaption>
                    <span className="card__name" title={p.filename}>
                      {p.filename}
                    </span>
                    <span className="card__meta">
                      {p.dateTimeOriginal?.replace("T", " ") ?? "no date"}
                      {p.offsetTimeOriginal ? ` (${p.offsetTimeOriginal})` : ""}
                    </span>
                    {fix ? (
                      <span
                        className={[
                          "card__badge card__badge--pending",
                          fix.interpolated ? `conf-${fix.confidence}` : "",
                        ]
                          .filter(Boolean)
                          .join(" ")}
                      >
                        → {fix.lat.toFixed(5)}, {fix.lng.toFixed(5)}
                        {fix.interpolated ? ` · ${fix.confidence}` : ""}
                        <button
                          className="card__clear"
                          onClick={(e) => {
                            e.stopPropagation();
                            clearPending(p.filename);
                          }}
                          title="Discard pending"
                        >
                          ×
                        </button>
                      </span>
                    ) : located_ ? (
                      <span className="card__badge">
                        {p.decLat!.toFixed(5)}, {p.decLng!.toFixed(5)}
                      </span>
                    ) : (
                      <span className="card__badge card__badge--missing">no location</span>
                    )}
                  </figcaption>
                </figure>
              );
            })
          )}
        </section>
      </main>

      {results ? (
        <div className="results" role="status">
          Wrote {results.filter((r) => r.ok).length}/{results.length}.
          {results.some((r) => !r.ok)
            ? ` Failed: ${results.filter((r) => !r.ok).map((r) => r.filename).join(", ")}`
            : " All good."}
          {results.some((r) => r.ok) ? (
            <span className="toolbar__hint">
              Run <code>index/do-retag.sh</code> to refresh the search DB.
            </span>
          ) : null}
          <button onClick={() => setResults(null)}>dismiss</button>
        </div>
      ) : null}
    </div>
  );
};
