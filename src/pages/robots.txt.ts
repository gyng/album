import type { GetServerSideProps } from "next";
import { getCanonicalUrl } from "../lib/seo";

const buildRobotsTxt = (): string => {
  const sitemapUrl = getCanonicalUrl("/sitemap.xml");

  return [
    "User-agent: *",
    "Allow: /",
    "Disallow: /search",
    "Disallow: /slideshow",
    "",
    `Sitemap: ${sitemapUrl}`,
    "",
  ].join("\n");
};

export const getServerSideProps: GetServerSideProps = async ({ res }) => {
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.write(buildRobotsTxt());
  res.end();

  return {
    props: {},
  };
};

const RobotsTxt = () => null;

export { buildRobotsTxt };
export default RobotsTxt;
