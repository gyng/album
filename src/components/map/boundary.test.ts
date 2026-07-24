import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

/*
 * The map module's contract, enforced rather than merely documented.
 *
 * `components/map/index.ts` is the public face: the neutral React API plus the
 * port vocabulary. Application code imports from there, so the engine behind it
 * stays swappable and the screens stay portable. Two things quietly undo that:
 * a component reaching past the barrel into `./map/adapters/…`, and anything
 * outside the adapter importing `maplibre-gl` itself.
 *
 * Modelled on `components/platform/boundary.test.ts`, which does the same job
 * for the Next.js renderer boundary.
 */

/*
 * `public/` is deliberately absent: it holds the vendored MapLibre worker
 * bundles that the adapter loads by URL, which are copies of the engine rather
 * than code that imports it.
 */
const SOURCE_ROOTS = ["app", "bin", "components", "lib", "pages", "screens", "services", "util"];

/** The one module tree allowed to name the engine. */
const ENGINE_ROOT = path.join("components", "map", "adapters", "maplibre");

/** The module tree allowed to reach into the adapters at all. */
const MAP_MODULE_ROOT = path.join("components", "map");

/** Everything below here is an implementation detail of the map module. */
const ADAPTER_ROOT = path.join("components", "map", "adapters");

const parseSource = (source: string, filename: string): ts.SourceFile =>
  ts.createSourceFile(
    filename,
    source,
    ts.ScriptTarget.Latest,
    true,
    filename.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );

/** Every module specifier the file names, including type-only and dynamic ones. */
const importedModules = (source: string, filename: string): string[] => {
  const sourceFile = parseSource(source, filename);
  const specifiers: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteralLike(node.moduleSpecifier)) {
      specifiers.push(node.moduleSpecifier.text);
    } else if (
      ts.isExportDeclaration(node) &&
      node.moduleSpecifier &&
      ts.isStringLiteralLike(node.moduleSpecifier)
    ) {
      specifiers.push(node.moduleSpecifier.text);
    } else if (
      ts.isCallExpression(node) &&
      node.arguments.length === 1 &&
      // invariant: length check above guarantees the first argument exists
      ts.isStringLiteralLike(node.arguments[0]!) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) && node.expression.text === "require"))
    ) {
      specifiers.push(node.arguments[0].text);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return specifiers;
};

const sourceFilesBelow = (directory: string): string[] =>
  fs
    .readdirSync(directory, { recursive: true })
    .filter((filename): filename is string => typeof filename === "string")
    .filter((filename) => /\.(?:js|cjs|mjs|ts|tsx)$/.test(filename) && !filename.includes(".test."))
    .map((filename) => path.join(directory, filename));

/*
 * Tests are excluded: mocking the adapter module is how the component tests
 * keep WebGL out of jsdom, and that is not a production dependency.
 */
const productionSourceFiles = (): string[] =>
  SOURCE_ROOTS.flatMap((directory) => sourceFilesBelow(path.join(process.cwd(), directory)));

/** Resolve a relative specifier the way the bundler would, or `null`. */
const resolveLocalModule = (fromFile: string, specifier: string): string | null => {
  if (!specifier.startsWith(".")) return null;
  const base = path.resolve(path.dirname(fromFile), specifier);
  const candidates = [
    base,
    `${base}.js`,
    `${base}.ts`,
    `${base}.tsx`,
    path.join(base, "index.js"),
    path.join(base, "index.ts"),
    path.join(base, "index.tsx"),
  ];
  return (
    candidates.find((candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isFile()) ??
    null
  );
};

const isInside = (relativePath: string, root: string): boolean =>
  relativePath === root || relativePath.startsWith(`${root}${path.sep}`);

describe("map module boundary", () => {
  it("keeps the map adapters private to the map module", () => {
    const reachThroughImports = productionSourceFiles().flatMap((filename) => {
      const relative = path.relative(process.cwd(), filename);
      if (isInside(relative, MAP_MODULE_ROOT)) {
        return [];
      }

      const source = fs.readFileSync(filename, "utf8");
      return importedModules(source, filename)
        .filter((specifier) => {
          const resolved = resolveLocalModule(filename, specifier);
          // Unresolvable specifiers (a bare alias, say) are still caught by the
          // shape of the path they name.
          return resolved
            ? isInside(path.relative(process.cwd(), resolved), ADAPTER_ROOT)
            : specifier.split("/").includes("adapters") && specifier.includes("map");
        })
        .map((specifier) => `${relative}: ${specifier}`);
    });

    expect(reachThroughImports).toEqual([]);
  });

  it("keeps maplibre-gl inside its adapter", () => {
    const engineImports = productionSourceFiles().flatMap((filename) => {
      const relative = path.relative(process.cwd(), filename);
      if (isInside(relative, ENGINE_ROOT)) {
        return [];
      }

      const source = fs.readFileSync(filename, "utf8");
      return importedModules(source, filename)
        .filter((specifier) => specifier === "maplibre-gl" || specifier.startsWith("maplibre-gl/"))
        .map((specifier) => `${relative}: ${specifier}`);
    });

    expect(engineImports).toEqual([]);
  });
});
