import type { GetStaticProps } from "next";
import ExploreScreen, { type ExploreScreenProps } from "../../screens/explore/ExploreScreen";
import { measureBuild } from "../../services/buildTiming";
import { loadExplorePageData } from "../../services/pageData/explore";
import { packExploreStats } from "../../util/explorePageData";

export const getStaticProps: GetStaticProps<ExploreScreenProps> = async () =>
  measureBuild("page./explore.getStaticProps", async () => {
    const { stats, visualSameness } = await loadExplorePageData();
    return { props: { packedStats: packExploreStats(stats), visualSameness } };
  });

export default ExploreScreen;
