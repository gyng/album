import type React from "react";
import type { MapProps } from "../Map";
import type { MapWorldProps } from "../MapWorld";
import type { SankeyChartProps } from "../SankeyChart";
import type { TripRouteMapProps } from "../TripRouteMap";
import type { GuessMapProps } from "../guess/GuessMap";
import type { SearchNavState } from "../search/Search";

export type PhotoSimilarPhotosProps = {
  path?: string | null;
  pageSize?: number;
};

export type SearchWithCoiProps = {
  onNavStateChange?: (state: SearchNavState) => void;
};

export type ClientComponents = {
  Map: React.ComponentType<MapProps>;
  MapWorld: React.ComponentType<MapWorldProps>;
  PhotoSimilarPhotos: React.ComponentType<PhotoSimilarPhotosProps>;
  SankeyChart: React.ComponentType<SankeyChartProps>;
  TripRouteMap: React.ComponentType<TripRouteMapProps>;
  GuessMap: React.ComponentType<GuessMapProps>;
  SearchWithCoi: React.ComponentType<SearchWithCoiProps>;
};
