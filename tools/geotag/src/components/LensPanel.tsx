import type { LensDraft, LensMetadata, LensPreset } from "../lens.ts";
import { lensSummary, normaliseLensDraft } from "../lens.ts";

type LensPanelProps = {
  presets: LensPreset[];
  draft: LensDraft;
  selectedCount: number;
  missingCount: number;
  onDraftChange: (draft: LensDraft) => void;
  onSavePreset: (lens: LensMetadata & { name: string }) => void;
  onApply: (lens: LensMetadata, target: "selected" | "missing") => void;
  onDeletePreset: (id: string) => void;
};

const update = (draft: LensDraft, field: keyof LensDraft, value: string): LensDraft => ({
  ...draft,
  [field]: value,
});

export const LensPanel = ({
  presets,
  draft,
  selectedCount,
  missingCount,
  onDraftChange,
  onSavePreset,
  onApply,
  onDeletePreset,
}: LensPanelProps) => {
  const lens = normaliseLensDraft(draft);

  return (
    <aside className="lensPanel" aria-label="Manual lens presets">
      <header className="lensPanel__header">
        <span className="eyebrow">Manual lens bench</span>
        <h2>Stamp the lens, not every frame.</h2>
        <p>Save a lens once, select its photos, then apply it as a batch.</p>
      </header>

      <section className="presetRack" aria-labelledby="saved-lenses-heading">
        <div className="sectionHeading">
          <h3 id="saved-lenses-heading">Saved lenses</h3>
          <span>{presets.length}</span>
        </div>
        {presets.length === 0 ? (
          <p className="emptyNote">Add your first manual lens below. It stays saved in this browser.</p>
        ) : (
          <div className="presetList">
            {presets.map((preset) => (
              <article className="preset" key={preset.id}>
                <div className="preset__copy">
                  <strong>{preset.name}</strong>
                  <span>{lensSummary(preset)}</span>
                </div>
                <div className="preset__actions">
                  <button
                    className="preset__apply"
                    onClick={() => onApply(preset, "selected")}
                    disabled={selectedCount === 0}
                  >
                    Apply to {selectedCount || "selected"}
                  </button>
                  <button
                    className="preset__apply"
                    onClick={() => onApply(preset, "missing")}
                    disabled={missingCount === 0}
                    title="Assign this lens to every photo without lens metadata"
                  >
                    All {missingCount || "missing"}
                  </button>
                  <button
                    className="iconButton"
                    onClick={() => onDeletePreset(preset.id)}
                    aria-label={`Delete ${preset.name} preset`}
                    title="Delete preset"
                  >
                    ×
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      <form
        className="lensForm"
        onSubmit={(event) => {
          event.preventDefault();
          if (lens) onSavePreset(lens);
        }}
      >
        <div className="sectionHeading">
          <h3>New preset</h3>
          <span>EXIF</span>
        </div>
        <label>
          <span>Preset name</span>
          <input
            value={draft.name}
            onChange={(event) => onDraftChange(update(draft, "name", event.target.value))}
            placeholder="My 35 Nokton"
          />
        </label>
        <div className="lensForm__pair">
          <label>
            <span>Maker <small>optional</small></span>
            <input
              value={draft.make}
              onChange={(event) => onDraftChange(update(draft, "make", event.target.value))}
              placeholder="Voigtländer"
            />
          </label>
          <label>
            <span>Lens model <b>required</b></span>
            <input
              value={draft.model}
              onChange={(event) => onDraftChange(update(draft, "model", event.target.value))}
              placeholder="NOKTON 35mm F1.2"
              required
            />
          </label>
        </div>
        <div className="lensForm__pair">
          <label>
            <span>Focal length <small>mm</small></span>
            <input
              type="number"
              min="0.1"
              step="any"
              inputMode="decimal"
              value={draft.focalLength}
              onChange={(event) => onDraftChange(update(draft, "focalLength", event.target.value))}
              placeholder="35"
            />
          </label>
          <label>
            <span>35 mm equivalent <small>mm</small></span>
            <input
              type="number"
              min="0.1"
              step="any"
              inputMode="decimal"
              value={draft.focalLength35mm}
              onChange={(event) =>
                onDraftChange(update(draft, "focalLength35mm", event.target.value))
              }
              placeholder="53"
            />
          </label>
        </div>
        <p className="lensForm__note">
          Aperture is intentionally omitted—it can change frame by frame on a manual lens.
        </p>
        <div className="lensForm__actions">
          <button type="submit" disabled={!lens}>Save preset</button>
          <button
            type="button"
            className="primary"
            disabled={!lens || selectedCount === 0}
            onClick={() => lens && onApply(lens, "selected")}
          >
            Apply once to {selectedCount || "selected"}
          </button>
        </div>
        {presets.length > 0 && missingCount > 0 ? (
          <p className="lensForm__note">
            “All {missingCount}” is the fastest route when the whole untagged batch used one lens.
          </p>
        ) : null}
      </form>
    </aside>
  );
};
