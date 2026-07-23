import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const SOURCE_ROOTS = ["app", "components", "lib", "pages", "public", "screens", "services", "util"];
const NODE_RUNTIME_MODULES = new Set([
  "assert",
  "buffer",
  "child_process",
  "crypto",
  "events",
  "fs",
  "http",
  "https",
  "module",
  "os",
  "path",
  "process",
  "stream",
  "url",
  "util",
  "worker_threads",
  "zlib",
]);
const NEXT_RUNTIME_ADAPTERS = new Map<string, Set<string>>([
  [
    "components/platform/next/NextPlatformProvider.tsx",
    new Set(["next/head", "next/link", "next/router"]),
  ],
  ["components/platform/next/nextClientComponents.tsx", new Set(["next/dynamic"])],
  ["pages/_app.tsx", new Set(["next/app"])],
  ["pages/_document.tsx", new Set(["next/document"])],
  ["pages/album/[[...slug]].tsx", new Set(["next"])],
  ["pages/explore/index.tsx", new Set(["next"])],
  ["pages/index.tsx", new Set(["next"])],
  ["pages/map/index.tsx", new Set(["next"])],
  ["pages/timeline/index.tsx", new Set(["next"])],
]);

type ModuleImport = { name: string; typeOnly: boolean };

const parseSource = (source: string, filename: string): ts.SourceFile =>
  ts.createSourceFile(
    filename,
    source,
    ts.ScriptTarget.Latest,
    true,
    filename.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );

const importedModules = (source: string, filename: string): ModuleImport[] => {
  const sourceFile = parseSource(source, filename);
  const imports: ModuleImport[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteralLike(node.moduleSpecifier)) {
      imports.push({
        name: node.moduleSpecifier.text,
        typeOnly: node.importClause?.isTypeOnly ?? false,
      });
    } else if (
      ts.isExportDeclaration(node) &&
      node.moduleSpecifier &&
      ts.isStringLiteralLike(node.moduleSpecifier)
    ) {
      imports.push({ name: node.moduleSpecifier.text, typeOnly: node.isTypeOnly });
    } else if (
      ts.isCallExpression(node) &&
      node.arguments.length === 1 &&
      // invariant: length check above guarantees the first argument exists
      ts.isStringLiteralLike(node.arguments[0]!) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) && node.expression.text === "require"))
    ) {
      imports.push({ name: node.arguments[0].text, typeOnly: false });
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return imports;
};

const sourceFilesBelow = (directory: string): string[] =>
  fs
    .readdirSync(directory, { recursive: true })
    .filter((filename): filename is string => typeof filename === "string")
    .filter((filename) => /\.(?:js|ts|tsx)$/.test(filename) && !filename.includes(".test."))
    .map((filename) => path.join(directory, filename));

const productionSourceFiles = (): string[] =>
  SOURCE_ROOTS.flatMap((directory) => sourceFilesBelow(path.join(process.cwd(), directory)));

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

describe("framework boundary", () => {
  it("keeps all Next dependencies inside routes and explicit adapters", () => {
    const unexpectedImports = productionSourceFiles().flatMap((filename) => {
      const source = fs.readFileSync(filename, "utf8");
      const relative = path.relative(process.cwd(), filename);
      if (relative.startsWith("app/")) {
        return [];
      }
      const expectedModules = NEXT_RUNTIME_ADAPTERS.get(relative) ?? new Set();
      return importedModules(source, filename)
        .map(({ name }) => name)
        .filter((moduleName) => moduleName === "next" || moduleName.startsWith("next/"))
        .filter((moduleName) => !expectedModules.has(moduleName))
        .map((moduleName) => `${relative}: ${moduleName}`);
    });

    expect(unexpectedImports).toEqual([]);
  });

  it("does not depend on Next's private client or data paths", () => {
    const privateContractUsers = productionSourceFiles().flatMap((filename) => {
      const source = fs.readFileSync(filename, "utf8");
      return source.includes("__NEXT_DATA__") || source.includes("/_next/")
        ? [path.relative(process.cwd(), filename)]
        : [];
    });

    expect(privateContractUsers).toEqual([]);
  });

  it("keeps build-time services independent of React, Next, and components", () => {
    const serviceRoot = path.join(process.cwd(), "services");
    const forbiddenImports = sourceFilesBelow(serviceRoot).flatMap((filename) => {
      const source = fs.readFileSync(filename, "utf8");
      const relative = path.relative(process.cwd(), filename);
      return importedModules(source, filename)
        .map(({ name }) => name)
        .filter(
          (moduleName) =>
            moduleName === "react" ||
            moduleName.startsWith("react/") ||
            moduleName === "next" ||
            moduleName.startsWith("next/") ||
            moduleName.split("/").includes("components"),
        )
        .map((moduleName) => `${relative}: ${moduleName}`);
    });

    expect(forbiddenImports).toEqual([]);
  });

  it("keeps client imports of service contracts type-only", () => {
    const clientRoots = ["components", "lib", "pages", "screens", "util"];
    const valueImports = clientRoots.flatMap((directory) =>
      sourceFilesBelow(path.join(process.cwd(), directory)).flatMap((filename) => {
        const source = fs.readFileSync(filename, "utf8");
        const importsServiceTypesAsValue = importedModules(source, filename).some(
          (moduleImport) => moduleImport.name.endsWith("services/types") && !moduleImport.typeOnly,
        );
        return importsServiceTypesAsValue ? [path.relative(process.cwd(), filename)] : [];
      }),
    );

    expect(valueImports).toEqual([]);
  });

  it("keeps screens free of runtime service dependencies", () => {
    const screenRoot = path.join(process.cwd(), "screens");
    const runtimeImports = sourceFilesBelow(screenRoot).flatMap((filename) => {
      const source = fs.readFileSync(filename, "utf8");
      return importedModules(source, filename)
        .filter(
          (moduleImport) =>
            moduleImport.name.split("/").includes("services") && !moduleImport.typeOnly,
        )
        .map((moduleImport) => `${path.relative(process.cwd(), filename)}: ${moduleImport.name}`);
    });

    expect(runtimeImports).toEqual([]);
  });

  it("keeps the complete screen runtime graph browser-portable", () => {
    const pending = sourceFilesBelow(path.join(process.cwd(), "screens"));
    const visited = new Set<string>();
    const portabilityFailures: string[] = [];

    while (pending.length > 0) {
      const filename = pending.pop()!;
      if (visited.has(filename)) continue;
      visited.add(filename);
      const source = fs.readFileSync(filename, "utf8");
      for (const moduleImport of importedModules(source, filename)) {
        if (moduleImport.typeOnly) continue;
        if (moduleImport.name === "next" || moduleImport.name.startsWith("next/")) {
          portabilityFailures.push(
            `${path.relative(process.cwd(), filename)}: ${moduleImport.name}`,
          );
          continue;
        }
        if (moduleImport.name.startsWith("node:") || NODE_RUNTIME_MODULES.has(moduleImport.name)) {
          portabilityFailures.push(
            `${path.relative(process.cwd(), filename)}: ${moduleImport.name}`,
          );
          continue;
        }
        const dependency = resolveLocalModule(filename, moduleImport.name);
        if (dependency && !visited.has(dependency)) pending.push(dependency);
      }

      const sourceFile = parseSource(source, filename);
      const visit = (node: ts.Node): void => {
        if (
          ts.isIdentifier(node) &&
          (node.text === "process" ||
            node.text === "Buffer" ||
            node.text === "__dirname" ||
            node.text === "__filename")
        ) {
          portabilityFailures.push(
            `${path.relative(process.cwd(), filename)}: global ${node.text}`,
          );
        }
        ts.forEachChild(node, visit);
      };
      visit(sourceFile);
    }

    expect([...new Set(portabilityFailures)]).toEqual([]);
  });

  it("keeps rendered UI out of page route adapters", () => {
    const pageRoot = path.join(process.cwd(), "pages");
    const routesWithJsx = sourceFilesBelow(pageRoot).flatMap((filename) => {
      const relative = path.relative(process.cwd(), filename);
      if (relative === "pages/_app.tsx" || relative === "pages/_document.tsx") {
        return [];
      }
      const sourceFile = parseSource(fs.readFileSync(filename, "utf8"), filename);
      let hasJsx = false;
      const visit = (node: ts.Node): void => {
        if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node) || ts.isJsxFragment(node)) {
          hasJsx = true;
          return;
        }
        ts.forEachChild(node, visit);
      };
      visit(sourceFile);
      return hasJsx ? [relative] : [];
    });

    expect(routesWithJsx).toEqual([]);
  });

  it("keeps application styles out of the Next route tree", () => {
    const pageRoot = path.join(process.cwd(), "pages");
    const routeOwnedStyles = fs
      .readdirSync(pageRoot, { recursive: true })
      .filter((filename): filename is string => typeof filename === "string")
      .filter((filename) => filename.endsWith(".css"));

    expect(routeOwnedStyles).toEqual([]);
  });
});
