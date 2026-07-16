import type { GetStaticProps } from "next";
import TimelineScreen, { type TimelineScreenProps } from "../../screens/timeline/TimelineScreen";
import { measureBuild } from "../../services/buildTiming";
import { loadTimelinePageData } from "../../services/pageData/timeline";

export const getStaticProps: GetStaticProps<TimelineScreenProps> = async () =>
  measureBuild("page./timeline.getStaticProps", async () => ({
    props: await loadTimelinePageData(),
  }));

export default TimelineScreen;
