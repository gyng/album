import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { siteConfig } from "../lib/siteConfig";

// Guards the config seam: the site's name must reach the UI through
// lib/siteConfig, never as a literal typed into a screen. Because the needle
// comes from the configuration itself, this protects a fork's own name too,
// not just this site's.
//
// Only string literals, template chunks and JSX text are inspected — prose in
// comments is free to mention the name.

const SOURCE_ROOTS = ["components", "lib", "pages", "screens", "util"];

const ALLOWED = new Set([path.join("lib", "siteConfig.ts")]);

const parseSource = (source: string, filename: string): ts.SourceFile =>
  ts.createSourceFile(
    filename,
    source,
    ts.ScriptTarget.Latest,
    true,
    filename.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );

const sourceFilesBelow = (directory: string): string[] => {
  const absolute = path.join(process.cwd(), directory);
  if (!fs.existsSync(absolute)) {
    return [];
  }

  return fs
    .readdirSync(absolute, { recursive: true })
    .filter((filename): filename is string => typeof filename === "string")
    .filter((filename) => /\.tsx?$/.test(filename) && !filename.includes(".test."))
    .map((filename) => path.join(directory, filename));
};

const literalsIn = (source: ts.SourceFile): string[] => {
  const found: string[] = [];

  const visit = (node: ts.Node): void => {
    if (
      ts.isStringLiteral(node) ||
      ts.isNoSubstitutionTemplateLiteral(node) ||
      ts.isTemplateHead(node) ||
      ts.isTemplateMiddle(node) ||
      ts.isTemplateTail(node) ||
      ts.isJsxText(node)
    ) {
      found.push(node.text);
    }
    ts.forEachChild(node, visit);
  };

  visit(source);
  return found;
};

describe("site branding stays in configuration", () => {
  const siteName = siteConfig.site.name;

  it("finds the configured site name in no source literal outside lib/siteConfig.ts", () => {
    const offenders = SOURCE_ROOTS.flatMap(sourceFilesBelow)
      .filter((filename) => !ALLOWED.has(filename))
      .filter((filename) =>
        literalsIn(
          parseSource(fs.readFileSync(path.join(process.cwd(), filename), "utf8"), filename),
        ).some((literal) => literal.includes(siteName)),
      );

    expect(offenders).toEqual([]);
  });

  it("inspects a meaningful number of files, so a broken glob cannot pass silently", () => {
    expect(SOURCE_ROOTS.flatMap(sourceFilesBelow).length).toBeGreaterThan(50);
  });
});

// The metered provider is gone: every basemap is either OpenFreeMap's or a
// document this site serves itself. This is the guard that keeps it that way —
// a style URL pointing back at a keyed provider would reintroduce a credential,
// a quota and an attribution obligation in one line.
describe("no metered map provider", () => {
  const METERED_HOSTS = ["api.maptiler.com", "api.mapbox.com"];

  it("names no keyed provider host in any source literal", () => {
    const offenders = SOURCE_ROOTS.flatMap(sourceFilesBelow).filter((filename) =>
      literalsIn(
        parseSource(fs.readFileSync(path.join(process.cwd(), filename), "utf8"), filename),
      ).some((literal) => METERED_HOSTS.some((host) => literal.includes(host))),
    );

    expect(offenders).toEqual([]);
  });
});
