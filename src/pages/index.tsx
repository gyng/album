import type { GetStaticProps } from "next";
import HomeScreen, { type HomeScreenProps } from "../screens/HomeScreen";
import { measureBuild } from "../services/buildTiming";
import { loadHomePageData } from "../services/pageData/home";

export const getStaticProps: GetStaticProps<HomeScreenProps> = async () =>
  measureBuild("page./.getStaticProps", async () => ({ props: await loadHomePageData() }));

export default HomeScreen;
