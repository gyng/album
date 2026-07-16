/* oxlint-disable next/no-css-tags -- MapLibre's global CSS is deliberately generated as a static asset and loaded only when a map mounts. */
import { DocumentHead } from "./platform";

/** Loads MapLibre's global stylesheet only on pages or states that render a map. */
export const MapLibreStyles: React.FC = () => (
  <DocumentHead>
    <link key="maplibre-styles" rel="stylesheet" href="/vendor/maplibre-gl.css" />
  </DocumentHead>
);
