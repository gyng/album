import dynamic from "next/dynamic";
import mapStyles from "../../Map.module.css";
import mapWorldStyles from "../../MapWorld.module.css";
import photoStyles from "../../Photo.module.css";
import guessStyles from "../../guess/GuessGame.module.css";
import type { ClientComponents } from "../clientComponents";

export const nextClientComponents: ClientComponents = {
  EmbeddingSpace: dynamic(
    () => import("../../EmbeddingSpace").then((module) => module.EmbeddingSpace),
    { ssr: false },
  ),
  ContactSheet: dynamic(() => import("../../ContactSheet").then((module) => module.ContactSheet), {
    ssr: false,
  }),
  Map: dynamic(() => import("../../Map"), {
    loading: () => <p className={mapStyles.loadingPlaceholder}>Loading map…</p>,
    ssr: false,
  }),
  MapWorld: dynamic(() => import("../../MapWorld"), {
    loading: () => <p className={mapWorldStyles.loadingPlaceholder}>Loading map…</p>,
    ssr: false,
  }),
  PhotoSimilarPhotos: dynamic(
    () => import("../../PhotoSimilarPhotos").then((module) => module.PhotoSimilarPhotos),
    {
      loading: () => <p className={photoStyles.similarPhotosStatus}>Loading similar photos…</p>,
      ssr: false,
    },
  ),
  SankeyChart: dynamic(() => import("../../SankeyChart").then((module) => module.SankeyChart), {
    ssr: false,
  }),
  TripRouteMap: dynamic(() => import("../../TripRouteMap"), { ssr: false }),
  GuessMap: dynamic(() => import("../../guess/GuessMapExport"), {
    loading: () => <div className={guessStyles.mapLoading} />,
    ssr: false,
  }),
  SearchWithCoi: dynamic(() => import("../../search/SearchWithCoi"), {
    loading: () => <p>Loading…</p>,
    ssr: false,
  }),
};
