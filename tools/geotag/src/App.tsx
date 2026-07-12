import { useCallback, useEffect, useMemo, useState } from "react";
import type { Track } from "@shared/gpsTrack";
import {
  isLocated,
  listFolder,
  parseLatLng,
  thumbUrl,
  writeGps,
  writeLens as writeLensMetadata,
  type FolderListing,
  type LensWriteResult,
  type PendingFix,
  type WriteResult,
} from "./api.ts";
import { FolderBar } from "./components/FolderBar.tsx";
import { GeotagMap, type PendingMarker } from "./components/GeotagMap.tsx";
import { LensPanel } from "./components/LensPanel.tsx";
import { TrackPanel } from "./components/TrackPanel.tsx";
import {
  assignLensToPhotos,
  isLensMissing,
  lensSummary,
  parseLensPresets,
  upsertLensPreset,
  type LensDraft,
  type LensMetadata,
  type LensPreset,
} from "./lens.ts";

type WorkMode = "location" | "lens";
type ResultNotice = {
  kind: WorkMode;
  results: Array<WriteResult | LensWriteResult>;
};

const PRESET_STORAGE_KEY = "geotag.manual-lens-presets.v1";
const EMPTY_LENS_DRAFT: LensDraft = {
  name: "",
  make: "",
  model: "",
  focalLength: "",
  focalLength35mm: "",
};

const loadPresets = (): LensPreset[] => {
  if (typeof window === "undefined") return [];
  return parseLensPresets(window.localStorage.getItem(PRESET_STORAGE_KEY) ?? "[]");
};

const presetId = (): string =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;

export const App = () => {
  const [listing, setListing] = useState<FolderListing | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<WorkMode>("location");

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pending, setPending] = useState<Record<string, PendingFix>>({});
  const [pendingLens, setPendingLens] = useState<Record<string, LensMetadata>>({});
  const [coordsInput, setCoordsInput] = useState("");
  const [writing, setWriting] = useState(false);
  const [notice, setNotice] = useState<ResultNotice | null>(null);
  const [track, setTrack] = useState<Track | null>(null);
  const [lensPresets, setLensPresets] = useState<LensPreset[]>(loadPresets);
  const [lensDraft, setLensDraft] = useState<LensDraft>(EMPTY_LENS_DRAFT);

  const folder = listing?.path ?? "";
  const folderParts = listing?.path.split(/[\\/]/).filter(Boolean) ?? [];
  const folderName = folderParts[folderParts.length - 1] ?? "Photos";
  const photos = useMemo(() => listing?.photos ?? [], [listing]);

  useEffect(() => {
    try {
      window.localStorage.setItem(PRESET_STORAGE_KEY, JSON.stringify(lensPresets));
    } catch {
      setError("Could not save lens presets in this browser.");
    }
  }, [lensPresets]);

  const fetchInto = useCallback((folderPath: string | undefined) => {
    setLoading(true);
    setError(null);
    return listFolder(folderPath)
      .then(setListing)
      .catch((caught) => setError(String(caught)))
      .finally(() => setLoading(false));
  }, []);

  const navigate = useCallback(
    (folderPath?: string) => {
      setSelected(new Set());
      setPending({});
      setPendingLens({});
      setNotice(null);
      setTrack(null);
      return fetchInto(folderPath);
    },
    [fetchInto],
  );

  useEffect(() => {
    void navigate();
  }, [navigate]);

  const located = useMemo(() => photos.filter(isLocated), [photos]);
  const missingLens = useMemo(() => photos.filter(isLensMissing), [photos]);
  const unassignedMissingLens = useMemo(
    () => missingLens.filter((photo) => !pendingLens[photo.filename]),
    [missingLens, pendingLens],
  );
  const lensTaggedCount = photos.length - missingLens.length;
  const byName = useMemo(() => new Map(photos.map((photo) => [photo.filename, photo])), [photos]);
  const pendingMarkers: PendingMarker[] = useMemo(
    () => Object.entries(pending).map(([filename, fix]) => ({ filename, ...fix })),
    [pending],
  );

  const toggleSelect = (filename: string) =>
    setSelected((previous) => {
      const next = new Set(previous);
      if (next.has(filename)) next.delete(filename);
      else next.add(filename);
      return next;
    });

  const assignToSelected = (fix: PendingFix) => {
    if (selected.size === 0) return;
    setPending((previous) => {
      const next = { ...previous };
      for (const filename of selected) next[filename] = fix;
      return next;
    });
  };

  const onPendingDrag = (filename: string, lat: number, lng: number) =>
    setPending((previous) => ({ ...previous, [filename]: { lat, lng } }));

  const onInterpolated = (fixes: Record<string, PendingFix>) =>
    setPending((previous) => ({ ...previous, ...fixes }));

  const applyPasted = () => {
    const fix = parseLatLng(coordsInput);
    if (!fix) {
      setError("Could not parse coordinates — expected ‘lat, lng’.");
      return;
    }
    setError(null);
    assignToSelected(fix);
    setCoordsInput("");
  };

  const clearPending = (filename: string) =>
    setPending((previous) => {
      const next = { ...previous };
      delete next[filename];
      return next;
    });

  const clearPendingLens = (filename: string) =>
    setPendingLens((previous) => {
      const next = { ...previous };
      delete next[filename];
      return next;
    });

  const selectAllMissing = () => {
    const candidates = mode === "location" ? photos.filter((photo) => !isLocated(photo)) : missingLens;
    setSelected(new Set(candidates.map((photo) => photo.filename)));
  };

  const applyLens = (lens: LensMetadata, target: "selected" | "missing") => {
    const filenames =
      target === "selected"
        ? selected
        : new Set(unassignedMissingLens.map((photo) => photo.filename));
    if (filenames.size === 0) return;
    setPendingLens((previous) => assignLensToPhotos(previous, filenames, lens));
  };

  const saveLensPreset = (lens: LensMetadata & { name: string }) => {
    setLensPresets((previous) => upsertLensPreset(previous, lens, presetId));
    setLensDraft(EMPTY_LENS_DRAFT);
  };

  const writeLocations = async () => {
    const items = Object.entries(pending)
      .map(([filename, fix]) => {
        const photo = byName.get(filename);
        return photo
          ? { filename, path: photo.path, lat: fix.lat, lng: fix.lng, interpolated: fix.interpolated }
          : null;
      })
      .filter((item): item is NonNullable<typeof item> => item !== null);
    if (items.length === 0) return;

    const confirmed = window.confirm(
      `Write GPS into ${items.length} original photo(s)?\n\nA “<file>_original” backup is kept beside each edited file.`,
    );
    if (!confirmed) return;

    setWriting(true);
    setError(null);
    try {
      const results = await writeGps(items, folder);
      setNotice({ kind: "location", results });
      const written = new Set(results.filter((result) => result.ok).map((result) => result.filename));
      setPending((previous) => {
        const next = { ...previous };
        for (const filename of written) delete next[filename];
        return next;
      });
      setSelected((previous) => new Set([...previous].filter((name) => !written.has(name))));
      if (written.size > 0) void fetchInto(folder);
    } catch (caught) {
      setError(String(caught));
    } finally {
      setWriting(false);
    }
  };

  const writeLenses = async () => {
    const items = Object.entries(pendingLens)
      .map(([filename, lens]) => {
        const photo = byName.get(filename);
        return photo ? { filename, path: photo.path, lens } : null;
      })
      .filter((item): item is NonNullable<typeof item> => item !== null);
    if (items.length === 0) return;

    const models = [...new Set(items.map((item) => item.lens.model))];
    const confirmed = window.confirm(
      `Write ${models.join(", ")} into ${items.length} original photo(s)?\n\nA “<file>_original” backup is kept beside each edited file.`,
    );
    if (!confirmed) return;

    setWriting(true);
    setError(null);
    try {
      const results = await writeLensMetadata(items, folder);
      setNotice({ kind: "lens", results });
      const written = new Set(results.filter((result) => result.ok).map((result) => result.filename));
      setPendingLens((previous) => {
        const next = { ...previous };
        for (const filename of written) delete next[filename];
        return next;
      });
      setSelected((previous) => new Set([...previous].filter((name) => !written.has(name))));
      if (written.size > 0) void fetchInto(folder);
    } catch (caught) {
      setError(String(caught));
    } finally {
      setWriting(false);
    }
  };

  const activePendingCount =
    mode === "location" ? pendingMarkers.length : Object.keys(pendingLens).length;
  const writeLabel = mode === "location" ? "location" : "lens tag";

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="eyebrow">Photo metadata</span>
          <h1>Tagging workbench</h1>
        </div>
        <nav className="modeSwitch" aria-label="Tagging mode">
          <button
            className={mode === "location" ? "modeSwitch__active" : ""}
            onClick={() => {
              setMode("location");
              setSelected(new Set());
            }}
            aria-pressed={mode === "location"}
          >
            <span>⌖</span> Location
          </button>
          <button
            className={mode === "lens" ? "modeSwitch__active" : ""}
            onClick={() => {
              setMode("lens");
              setSelected(new Set());
            }}
            aria-pressed={mode === "lens"}
          >
            <span>◉</span> Manual lens
          </button>
        </nav>
        <span className="topbar__stat">
          {loading
            ? "loading…"
            : mode === "location"
              ? `${located.length} / ${photos.length} located`
              : `${lensTaggedCount} / ${photos.length} lens-tagged`}
          {activePendingCount > 0 ? ` · ${activePendingCount} pending` : ""}
        </span>
        {error ? <span className="error" role="alert">{error}</span> : null}
      </header>

      {listing ? <FolderBar listing={listing} onOpen={navigate} /> : null}

      {photos.length > 0 ? (
        <>
          <div className="toolbar">
            <strong>{selected.size}</strong>
            <span className="stat">selected</span>
            <button onClick={selectAllMissing}>
              Select all {mode === "location" ? "without location" : "without lens"}
            </button>
            <button onClick={() => setSelected(new Set())} disabled={selected.size === 0}>
              Clear selection
            </button>
            {mode === "location" ? (
              <>
                <span className="toolbar__sep" />
                <input
                  className="coords"
                  placeholder="lat, lng"
                  aria-label="Coordinates"
                  value={coordsInput}
                  onChange={(event) => setCoordsInput(event.target.value)}
                  onKeyDown={(event) => event.key === "Enter" && applyPasted()}
                />
                <button onClick={applyPasted} disabled={selected.size === 0 || !coordsInput.trim()}>
                  Assign
                </button>
                <span className="toolbar__hint">
                  {selected.size > 0 ? "or click the map" : "select photos to place them"}
                </span>
              </>
            ) : (
              <span className="toolbar__hint">
                Choose a saved preset below; assignments stay pending until written.
              </span>
            )}
            <span className="toolbar__grow" />
            {mode === "lens" && activePendingCount > 0 ? (
              <button onClick={() => setPendingLens({})}>Clear pending</button>
            ) : null}
            <button
              className="primary"
              onClick={mode === "location" ? writeLocations : writeLenses}
              disabled={activePendingCount === 0 || writing}
            >
              {writing
                ? "Writing…"
                : `Write ${activePendingCount} ${writeLabel}${activePendingCount === 1 ? "" : "s"}`}
            </button>
          </div>
          <div hidden={mode !== "location"}>
            <TrackPanel
              key={folder}
              photos={photos}
              onTrack={setTrack}
              onInterpolated={onInterpolated}
            />
          </div>
        </>
      ) : null}

      <main className={["layout", mode === "lens" ? "layout--lens" : ""].filter(Boolean).join(" ")}>
        {mode === "location" ? (
          <section className="mapPane" aria-label="Location map">
            <GeotagMap
              located={located}
              pending={pendingMarkers}
              track={track}
              canPlace={selected.size > 0}
              onMapClick={(lat, lng) => assignToSelected({ lat, lng })}
              onPendingDrag={onPendingDrag}
            />
          </section>
        ) : (
          <LensPanel
            presets={lensPresets}
            draft={lensDraft}
            selectedCount={selected.size}
            missingCount={unassignedMissingLens.length}
            onDraftChange={setLensDraft}
            onSavePreset={saveLensPreset}
            onApply={applyLens}
            onDeletePreset={(id) => {
              const preset = lensPresets.find((candidate) => candidate.id === id);
              if (!preset || !window.confirm(`Delete the “${preset.name}” preset?`)) return;
              setLensPresets((previous) => previous.filter((candidate) => candidate.id !== id));
            }}
          />
        )}

        <section className="filmstrip" aria-label="Photo contact sheet">
          <header className="filmstrip__header">
            <div>
              <span className="eyebrow">Contact sheet</span>
              <strong>{folderName}</strong>
            </div>
            <span>{photos.length} frames</span>
          </header>
          {loading ? (
            <p className="hint">Loading…</p>
          ) : photos.length === 0 ? (
            <p className="hint">
              No photos in this folder. Open a folder above or choose one of its sub-folders.
            </p>
          ) : (
            photos.map((photo) => {
              const fix = pending[photo.filename];
              const lens = pendingLens[photo.filename];
              const hasLocation = isLocated(photo);
              const hasLens = !isLensMissing(photo);
              const pendingActive = mode === "location" ? Boolean(fix) : Boolean(lens);
              const completeActive = mode === "location" ? hasLocation : hasLens;
              return (
                <figure
                  key={photo.filename}
                  className={[
                    "card",
                    selected.has(photo.filename) ? "card--selected" : "",
                    pendingActive
                      ? "card--pending"
                      : completeActive
                        ? "card--complete"
                        : "card--missing",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  onClick={() => toggleSelect(photo.filename)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      toggleSelect(photo.filename);
                    }
                  }}
                  role="checkbox"
                  aria-checked={selected.has(photo.filename)}
                  tabIndex={0}
                >
                  <div className="card__image">
                    <img src={thumbUrl(photo.path, mode === "lens" ? 260 : 200)} alt="" loading="lazy" />
                    {selected.has(photo.filename) ? <span className="card__check">✓</span> : null}
                  </div>
                  <figcaption>
                    <span className="card__name" title={photo.filename}>{photo.filename}</span>
                    <span className="card__meta">
                      {photo.dateTimeOriginal?.replace("T", " ") ?? "no capture date"}
                      {photo.offsetTimeOriginal ? ` (${photo.offsetTimeOriginal})` : ""}
                    </span>
                    {mode === "location" ? (
                      fix ? (
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
                            onClick={(event) => {
                              event.stopPropagation();
                              clearPending(photo.filename);
                            }}
                            aria-label={`Discard pending location for ${photo.filename}`}
                          >×</button>
                        </span>
                      ) : hasLocation ? (
                        <span className="card__badge">{photo.decLat!.toFixed(5)}, {photo.decLng!.toFixed(5)}</span>
                      ) : (
                        <span className="card__badge card__badge--missing">no location</span>
                      )
                    ) : lens ? (
                      <span className="card__badge card__badge--pending">
                        → {lensSummary(lens)}
                        <button
                          className="card__clear"
                          onClick={(event) => {
                            event.stopPropagation();
                            clearPendingLens(photo.filename);
                          }}
                          aria-label={`Discard pending lens for ${photo.filename}`}
                        >×</button>
                      </span>
                    ) : hasLens ? (
                      <span className="card__badge">
                        {lensSummary({
                          make: photo.lensMake ?? "",
                          model: photo.lensModel ?? "",
                          focalLength: photo.focalLength,
                          focalLength35mm: photo.focalLength35mm,
                        })}
                      </span>
                    ) : (
                      <span className="card__badge card__badge--missing">no lens metadata</span>
                    )}
                  </figcaption>
                </figure>
              );
            })
          )}
        </section>
      </main>

      {notice ? (
        <div className="results" role="status">
          <strong>
            Wrote {notice.results.filter((result) => result.ok).length}/{notice.results.length} {notice.kind} tags.
          </strong>
          {notice.results.some((result) => !result.ok)
            ? ` Failed: ${notice.results.filter((result) => !result.ok).map((result) => result.filename).join(", ")}`
            : " All good."}
          {notice.results.some((result) => result.ok) ? (
            <span className="toolbar__hint">Run <code>index/do-retag.sh</code> to refresh search.</span>
          ) : null}
          <button onClick={() => setNotice(null)}>Dismiss</button>
        </div>
      ) : null}
    </div>
  );
};
