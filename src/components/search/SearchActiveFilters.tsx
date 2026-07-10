import type { RGB } from "../../util/colorDistance";
import { rgbToHex, rgbToString } from "../../util/colorDistance";
import {
  getSearchFacetChipLabel,
  type SearchFacetSelection,
  serializeSearchFacetSelection,
} from "../../util/searchFacets";
import styles from "./Search.module.css";
import type { ImageQuery } from "./useImageQuery";

export const SearchActiveFilters = ({
  imageQuery,
  colour,
  searchTerms,
  selectedFacets,
  onClearImage,
  onClearColour,
  onRemoveTerm,
  onRemoveFacet,
}: {
  imageQuery: ImageQuery | null;
  colour: RGB | null;
  searchTerms: string[];
  selectedFacets: SearchFacetSelection[];
  onClearImage: () => void;
  onClearColour: () => void;
  onRemoveTerm: (term: string) => void;
  onRemoveFacet: (selection: SearchFacetSelection) => void;
}) => {
  if (
    !imageQuery &&
    !colour &&
    searchTerms.length === 0 &&
    selectedFacets.length === 0
  ) {
    return null;
  }

  return (
    <div className={styles.activeFacetSection}>
      <div className={styles.activeFacetLabel}>Active filters</div>
      <div className={styles.activeFacetChips}>
        {imageQuery ? (
          <button
            type="button"
            className={styles.activeFacetChip}
            onClick={onClearImage}
            title="Remove image query"
            aria-label="Remove image query"
          >
            <img
              className={styles.activeFacetImageThumb}
              src={imageQuery.previewUrl}
              alt=""
              aria-hidden="true"
            />
            <span>
              {imageQuery.source === "drawing"
                ? "Drawn sketch"
                : "Uploaded image"}
            </span>
            <span aria-hidden="true">×</span>
            <span
              className={styles.activeFacetImageZoom}
              data-testid="image-query-zoom"
              aria-hidden="true"
            >
              <img src={imageQuery.previewUrl} alt="" />
            </span>
          </button>
        ) : null}
        {colour ? (
          <button
            type="button"
            className={styles.activeFacetChip}
            onClick={onClearColour}
            title={`Remove filter Colour: ${rgbToHex(colour)}`}
            aria-label={`Remove filter Colour: ${rgbToHex(colour)}`}
          >
            <span
              className={styles.activeFacetColorSwatch}
              style={{ backgroundColor: rgbToString(colour) }}
              aria-hidden="true"
            />
            <span>{`Colour: ${rgbToHex(colour)}`}</span>
            <span aria-hidden="true">×</span>
          </button>
        ) : null}
        {searchTerms.map((term) => (
          <button
            key={`term-${term}`}
            type="button"
            className={styles.activeFacetChip}
            onClick={() => onRemoveTerm(term)}
            title={`Remove filter ${term}`}
            aria-label={`Remove filter ${term}`}
          >
            <span>{term}</span>
            <span aria-hidden="true">×</span>
          </button>
        ))}
        {selectedFacets.map((selection) => {
          const key = serializeSearchFacetSelection(selection);
          const chipLabel = getSearchFacetChipLabel(selection);
          return (
            <button
              key={key}
              type="button"
              className={styles.activeFacetChip}
              onClick={() => onRemoveFacet(selection)}
              title={`Remove filter ${chipLabel}`}
              aria-label={`Remove filter ${chipLabel}`}
            >
              <span>{chipLabel}</span>
              <span aria-hidden="true">×</span>
            </button>
          );
        })}
      </div>
    </div>
  );
};
