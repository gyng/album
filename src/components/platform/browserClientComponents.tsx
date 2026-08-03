import React from "react";
import mapStyles from "../Map.module.css";
import mapWorldStyles from "../MapWorld.module.css";
import photoStyles from "../Photo.module.css";
import guessStyles from "../guess/GuessGame.module.css";
import type { ClientComponents } from "./clientComponents";

const clientOnly = <Props extends object>(
  load: () => Promise<{ default: React.ComponentType<Props> }>,
  fallback: React.ReactNode = null,
): React.ComponentType<Props> => {
  const LazyComponent = React.lazy(load);
  return function ClientOnlyComponent(props: Props) {
    const [mounted, setMounted] = React.useState(false);
    React.useEffect(() => setMounted(true), []);
    if (!mounted) return fallback;
    return (
      <React.Suspense fallback={fallback}>
        <LazyComponent {...props} />
      </React.Suspense>
    );
  };
};

export const browserClientComponents: ClientComponents = {
  Map: clientOnly(
    () => import("../Map"),
    <p className={mapStyles.loadingPlaceholder}>Loading map…</p>,
  ),
  MapWorld: clientOnly(
    () => import("../MapWorld"),
    <p className={mapWorldStyles.loadingPlaceholder}>Loading map…</p>,
  ),
  PhotoSimilarPhotos: clientOnly(
    () =>
      import("../PhotoSimilarPhotos").then((module) => ({ default: module.PhotoSimilarPhotos })),
    <p className={photoStyles.similarPhotosStatus}>Loading similar photos…</p>,
  ),
  SankeyChart: clientOnly(() =>
    import("../SankeyChart").then((module) => ({ default: module.SankeyChart })),
  ),
  TripRouteMap: clientOnly(
    () => import("../TripRouteMap"),
    <p className={mapWorldStyles.loadingPlaceholder}>Loading map…</p>,
  ),
  GuessMap: clientOnly(
    () => import("../guess/GuessMapExport"),
    <div className={guessStyles.mapLoading} />,
  ),
  SearchWithCoi: clientOnly(() => import("../search/SearchWithCoi"), <p>Loading…</p>),
};
