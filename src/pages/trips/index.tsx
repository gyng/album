import type { GetStaticProps } from "next";
import TripsScreen, { type TripsScreenProps } from "../../screens/trips/TripsScreen";
import { measureBuild } from "../../services/buildTiming";
import { loadTripsPageData } from "../../services/pageData/trips";

export const getStaticProps: GetStaticProps<TripsScreenProps> = async () =>
  measureBuild("page./trips.getStaticProps", async () => ({
    props: await loadTripsPageData(),
  }));

export default TripsScreen;
