import type { GetStaticProps } from "next";
import ExploreScreen, { type ExploreScreenProps } from "../../screens/explore/ExploreScreen";
import { measureBuild } from "../../services/buildTiming";
import { loadExplorePageData } from "../../services/pageData/explore";

export const getStaticProps: GetStaticProps<ExploreScreenProps> = async () =>
  measureBuild("page./explore.getStaticProps", async () => ({
    props: await loadExplorePageData(),
  }));

export default ExploreScreen;
