import { expect, test } from "@playwright/test";

test.describe("Generated HTTP resources", () => {
  test("feed.xml serves valid RSS", async ({ request }) => {
    const response = await request.get("/feed.xml");
    expect(response.status()).toBe(200);

    const body = await response.text();
    expect(body).toContain('<rss version="2.0"');
    expect(body).toContain("<channel>");
    expect(body).toContain("</channel>");
  });

  test("sitemap.xml serves valid sitemap", async ({ request }) => {
    const response = await request.get("/sitemap.xml");
    expect(response.status()).toBe(200);

    const body = await response.text();
    expect(body).toContain("<urlset");
    expect(body).toContain("<loc>");
  });
});

test("game metadata links to a public changelog document", async ({ request }) => {
  const response = await request.get("/fun/meta.json");
  expect(response.ok()).toBe(true);
  const metadata = await response.json();
  const url = new URL(metadata.changelogUrl, response.url());
  expect(url.origin).toBe(new URL(response.url()).origin);
  const changelog = await request.get(url.href);
  expect(changelog.status()).toBe(200);
  expect(changelog.headers()["content-type"]).toContain("text/html");
});
