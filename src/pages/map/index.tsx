import type { GetStaticProps } from "next";
import MapScreen, { type MapScreenProps } from "../../screens/map/MapScreen";
import { measureBuild } from "../../services/buildTiming";
import { loadMapPageData } from "../../services/pageData/map";

export const getStaticProps: GetStaticProps<MapScreenProps> = async () =>
  measureBuild("page./map.getStaticProps", async () => ({ props: await loadMapPageData() }));

export default MapScreen;
