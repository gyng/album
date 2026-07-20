const fs = require("fs");
const path = require("path");
const readline = require("readline/promises");
const { stdin, stdout } = require("process");
const { spawn, execSync, execFileSync } = require("child_process");
const exifr = require("exifr");
const sqlite3 = require("sqlite3");

const PHOTO_EXTENSIONS = new Set([".jpg", ".jpeg"]);
const VIDEO_EXTENSIONS = new Set([".mp4", ".mov", ".m4v", ".webm", ".mkv", ".avi"]);
const ALBUM_CONFIG_FILENAME = "album.json";
const REPORT_FILENAME = ".publish-report.json";
const VERCEL_CLI = "npx --yes vercel@latest";

const shouldIncludeAlbum = (albumName) =>
  !albumName.startsWith("test-") || process.env.ALBUM_INCLUDE_TEST_ALBUMS === "1";

const NUMBER_FORMAT = new Intl.NumberFormat("en-US");
const ANSI = {
  reset: "\u001b[0m",
  bold: "\u001b[1m",
  dim: "\u001b[2m",
  red: "\u001b[31m",
  green: "\u001b[32m",
  yellow: "\u001b[33m",
  cyan: "\u001b[36m",
};

const toPosixPath = (value) => value.split(path.sep).join("/");

const isPhotoFile = (filename) => PHOTO_EXTENSIONS.has(path.extname(filename).toLowerCase());

const isVideoFile = (filename) => VIDEO_EXTENSIONS.has(path.extname(filename).toLowerCase());

const isZoneIdentifierFile = (filename) => filename.toLowerCase().includes(":zone.identifier");

const fileExists = (filePath) => {
  try {
    fs.accessSync(filePath, fs.constants.F_OK);
    return true;
  } catch {
    return false;
  }
};

const formatNumber = (value) => NUMBER_FORMAT.format(value);

const formatPercent = (value) => `${Math.round(value)}%`;

const styleText = (text, ...codes) => {
  if (!stdout.isTTY || codes.length === 0) {
    return text;
  }
  return `${codes.join("")}${text}${ANSI.reset}`;
};

const statusLabel = (level) => {
  switch (level) {
    case "ok":
      return styleText("[OK]", ANSI.green, ANSI.bold);
    case "warn":
      return styleText("[WARN]", ANSI.yellow, ANSI.bold);
    case "block":
      return styleText("[BLOCK]", ANSI.red, ANSI.bold);
    case "run":
      return styleText("[RUN]", ANSI.cyan, ANSI.bold);
    default:
      return styleText("[INFO]", ANSI.cyan, ANSI.bold);
  }
};

const printSection = (title) => {
  const line = "=".repeat(Math.max(24, title.length + 8));
  console.log(`\n${styleText(line, ANSI.dim)}`);
  console.log(styleText(title.toUpperCase(), ANSI.cyan, ANSI.bold));
  console.log(styleText(line, ANSI.dim));
};

const printStatRows = (rows) => {
  const width = rows.reduce((max, row) => Math.max(max, row.label.length), 0);
  for (const row of rows) {
    console.log(`  ${statusLabel(row.level ?? "info")} ${row.label.padEnd(width)}  ${row.value}`);
  }
};

const printInsightLines = (lines) => {
  for (const line of lines) {
    console.log(`  ${statusLabel(line.level ?? "info")} ${line.text}`);
  }
};

const printIndentedList = (items, prefix = "    - ") => {
  for (const item of items) {
    console.log(`${prefix}${item}`);
  }
};

const calculateAlbumDiagnostics = (album) => {
  const unreadablePhotos = album.newPhotos.filter((photo) => !photo.metadata.readable).length;
  const photosWithoutGps = album.newPhotos.filter(
    (photo) => photo.metadata.readable && !photo.metadata.hasGps,
  ).length;
  const photosMissingExifDate = album.newPhotos.filter(
    (photo) => photo.metadata.readable && !photo.metadata.capturedAt,
  ).length;

  return {
    unreadablePhotos,
    photosWithoutGps,
    photosMissingExifDate,
  };
};

const buildPreflightInsights = (report) => {
  const lines = [];

  if (!report.db.exists) {
    lines.push({
      level: "warn",
      text: "No existing search.sqlite found. The next index run will create a fresh database.",
    });
  } else {
    const embeddingText = report.db.hasEmbeddingsTable
      ? `${formatNumber(report.db.embeddingsCount)} embedding rows present`
      : "no embeddings table yet";
    lines.push({
      level: "info",
      text: `Current DB snapshot: ${formatNumber(report.db.imageCount)} indexed photos, ${embeddingText}.`,
    });
  }

  if (report.summary.newPhotos === 0 && report.summary.removedPhotos === 0) {
    lines.push({
      level: "ok",
      text: "No on-disk photo changes detected relative to the current database.",
    });
  } else {
    lines.push({
      level: "info",
      text: `${formatNumber(report.summary.newPhotos)} new photo(s) and ${formatNumber(report.summary.removedPhotos)} removed photo(s) need reconciliation.`,
    });
  }

  if (report.db.staleEmbeddingCount > 0) {
    const oldModels = (report.db.staleEmbeddingModelIds ?? []).join(", ") || "unknown";
    const newModels =
      (report.db.expectedEmbeddingModelIds ?? []).join(", ") ||
      report.db.currentEmbeddingModelId ||
      "unknown";
    lines.push({
      level: "warn",
      text: `Embedding model changed: ${oldModels} → ${newModels}. ${formatNumber(report.db.staleEmbeddingCount)} photo(s) will be re-embedded — this run will take significantly longer than usual.`,
    });
  } else if (report.db.missingEmbeddingCount > 0) {
    lines.push({
      level: "warn",
      text: `${formatNumber(report.db.missingEmbeddingCount)} indexed photo(s) have no embeddings yet and will be embedded on the next index run — this may take significantly longer than usual.`,
    });
  }

  if (report.summary.photosWithoutGps > 0) {
    lines.push({
      level: "warn",
      text: `${formatNumber(report.summary.photosWithoutGps)} new photo(s) are missing GPS and will not show up correctly in map views.`,
    });
  }

  if (report.summary.photosMissingExifDate > 0) {
    lines.push({
      level: "warn",
      text: `${formatNumber(report.summary.photosMissingExifDate)} new photo(s) are missing capture dates, so album ordering may be less reliable.`,
    });
  }

  if (report.summary.unreadablePhotos > 0) {
    lines.push({
      level: "block",
      text: `${formatNumber(report.summary.unreadablePhotos)} new photo(s) could not be read for EXIF or GPS metadata.`,
    });
  }

  if (report.summary.invalidAlbums > 0) {
    lines.push({
      level: "block",
      text: `${formatNumber(report.summary.invalidAlbums)} album manifest file(s) are invalid and will stop the wizard unless forced.`,
    });
  }

  return lines;
};

const buildAttentionAlbums = (report) => {
  return report.albums
    .map((album) => ({
      ...album,
      diagnostics: calculateAlbumDiagnostics(album),
    }))
    .filter(
      (album) =>
        album.newPhotos.length > 0 ||
        album.removedPhotos.length > 0 ||
        album.warnings.length > 0 ||
        album.blockers.length > 0,
    )
    .sort((left, right) => {
      const leftScore =
        left.blockers.length * 100 + left.warnings.length * 10 + left.newPhotos.length;
      const rightScore =
        right.blockers.length * 100 + right.warnings.length * 10 + right.newPhotos.length;
      return rightScore - leftScore;
    });
};

const buildVerificationInsights = (verification) => {
  const lines = [];

  if (verification.ok) {
    lines.push({
      level: "ok",
      text: `Images table coverage is complete (${formatNumber(verification.discoveredPhotoCount)} / ${formatNumber(verification.discoveredPhotoCount)} discovered photos).`,
    });
  } else {
    lines.push({
      level: "block",
      text: `${formatNumber(verification.missingPhotoPaths.length)} discovered photo(s) are missing from the images table.`,
    });
  }

  if (verification.newPhotoCount > 0) {
    lines.push({
      level: verification.missingNewPhotoPaths.length === 0 ? "ok" : "warn",
      text: `New-photo index coverage: ${formatPercent(verification.newPhotoCoveragePercent)} (${formatNumber(verification.newPhotoCount - verification.missingNewPhotoPaths.length)} / ${formatNumber(verification.newPhotoCount)}).`,
    });
  }

  if (verification.newEmbeddingCoveragePercent != null) {
    lines.push({
      level: verification.missingEmbeddingPaths.length === 0 ? "ok" : "warn",
      text: `New-photo embedding coverage: ${formatPercent(verification.newEmbeddingCoveragePercent)} (${formatNumber(verification.newPhotoCount - verification.missingEmbeddingPaths.length)} / ${formatNumber(verification.newPhotoCount)}).`,
    });
  }

  for (const warning of verification.warnings) {
    lines.push({ level: "warn", text: warning });
  }
  for (const blocker of verification.blockers) {
    lines.push({ level: "block", text: blocker });
  }

  return lines;
};

const parseArgs = (argv) => {
  const args = {
    dryRun: false,
    fastTrack: true,
    yes: false,
    json: false,
    indexOnly: false,
    deploy: false,
    force: false,
    skipPull: false,
    skipBuild: false,
  };

  for (const token of argv) {
    switch (token) {
      case "--dry-run":
        args.dryRun = true;
        break;
      case "--fast-track":
      case "--fasttrack":
        args.fastTrack = true;
        break;
      case "--interactive":
      case "--step-by-step":
        args.fastTrack = false;
        break;
      case "--yes":
        args.yes = true;
        break;
      case "--json":
        args.json = true;
        break;
      case "--index-only":
        args.indexOnly = true;
        break;
      case "--deploy":
        args.deploy = true;
        break;
      case "--force":
        args.force = true;
        break;
      case "--skip-pull":
        args.skipPull = true;
        break;
      case "--skip-build":
        args.skipBuild = true;
        break;
      default:
        throw new Error(`Unknown argument: ${token}`);
    }
  }

  return args;
};

// Single source of truth for "does anything need (re)indexing?". Kept in sync
// across resolveExecutionPlan, printExecutionPlan and the wizard entry point so
// the plan the user consents to matches what actually runs. Covers new/removed
// photos as well as missing and stale (post-model-switch) embeddings.
const hasIndexChanges = (report) =>
  report.summary.newPhotos > 0 ||
  report.summary.removedPhotos > 0 ||
  (report.db?.missingEmbeddingCount ?? 0) > 0 ||
  (report.db?.staleEmbeddingCount ?? 0) > 0;

// The canonical production origin (mirrors getSiteOrigin in src/lib/seo.ts).
const DEFAULT_SITE_ORIGIN = "https://photos.awoo.party";

// Files the deploy treats as *data*, not code. Real albums and both search DBs
// are gitignored so they never surface in a git diff anyway; listing them keeps
// classifyPublishDelta honest for the tracked test fixtures and future assets.
const DATA_PATH_PREFIXES = ["albums/"];
const DATA_PATH_SUFFIXES = ["/search.sqlite", "/search-embeddings.sqlite"];

const nonEmpty = (value) => {
  const trimmed = typeof value === "string" ? value.trim() : "";
  return trimmed ? trimmed : null;
};

const splitLines = (text) =>
  typeof text === "string"
    ? text
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
    : [];

const shortSha = (sha) => (typeof sha === "string" ? sha.slice(0, 7) : null);

const isDataPath = (filePath) =>
  DATA_PATH_PREFIXES.some((prefix) => filePath.startsWith(prefix)) ||
  DATA_PATH_SUFFIXES.some((suffix) => filePath.endsWith(suffix));

// Where to read the *live* deployed commit from. The local version.json is no
// use as a baseline — `npm run dev` and `build` both rewrite it to HEAD — so we
// ask the deployed site what it is actually running.
const getDeployedVersionUrl = (env = process.env) => {
  const raw =
    nonEmpty(env.NEXT_PUBLIC_SITE_URL) ??
    nonEmpty(env.SITE_URL) ??
    nonEmpty(env.VERCEL_PROJECT_PRODUCTION_URL);
  let origin = DEFAULT_SITE_ORIGIN;
  if (raw) {
    origin = raw.startsWith("http://") || raw.startsWith("https://") ? raw : `https://${raw}`;
  }
  return `${origin.replace(/\/+$/, "")}/version.json`;
};

// Given the deployed commit and the tracked files that differ from it, decide
// whether this publish ships new JavaScript or is a pure data refresh.
const classifyPublishDelta = ({ deployedSha, changedFiles }) => {
  const files = Array.isArray(changedFiles) ? changedFiles.filter(Boolean) : [];
  const dataFiles = files.filter(isDataPath);
  const codeFiles = files.filter((filePath) => !isDataPath(filePath));

  let kind;
  if (!deployedSha) {
    kind = "unknown";
  } else if (codeFiles.length > 0) {
    kind = "code";
  } else {
    kind = "data-only";
  }

  return { kind, codeFiles, dataFiles };
};

const buildDeploymentInsight = (deployment) => {
  if (!deployment || deployment.kind === "unknown") {
    return {
      level: "warn",
      text: `Publish type unknown — ${deployment?.reason ?? "could not determine the live deployment"}.`,
    };
  }

  const deployed = shortSha(deployment.deployedSha) ?? "production";
  if (deployment.kind === "code") {
    return {
      level: "info",
      text: `Includes a JS/code update: ${formatNumber(deployment.codeFiles.length)} source file(s) changed since production (${deployed}). This publish ships new JavaScript, not just data.`,
    };
  }

  return {
    level: "ok",
    text: `Pure data update: app code is unchanged from production (${deployed}). This publish only refreshes photo data and the search index — no JavaScript changes.`,
  };
};

const defaultRunGit = (cwd) => (gitArgs) =>
  execFileSync("git", gitArgs, {
    cwd,
    stdio: ["ignore", "pipe", "ignore"],
  }).toString();

const fetchDeployedSha = async ({ versionUrl, fetchImpl }) => {
  try {
    const signal =
      typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function"
        ? AbortSignal.timeout(6000)
        : undefined;
    const response = await fetchImpl(versionUrl, signal ? { signal } : {});
    if (!response.ok) {
      return { deployedSha: null, reason: `live version.json returned HTTP ${response.status}` };
    }
    const body = await response.json();
    const sha = nonEmpty(body?.gitSha) ?? nonEmpty(body?.buildVersion);
    if (!sha) {
      return { deployedSha: null, reason: `live version.json at ${versionUrl} had no gitSha` };
    }
    return { deployedSha: sha, reason: null };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { deployedSha: null, reason: `could not fetch ${versionUrl} (${message})` };
  }
};

// Resolves whether the pending publish is data-only or a code update by diffing
// the working tree against the commit the live site reports it is running.
// Never throws: any failure (offline, git error, unknown commit) resolves to a
// shaped { kind: "unknown", reason } object so it can only ever inform, not
// block, the publish.
const resolveDeploymentDelta = async ({
  repoDir,
  versionUrl,
  fetchImpl = globalThis.fetch,
  runGit = defaultRunGit(repoDir),
}) => {
  const base = {
    deployedSha: null,
    headSha: null,
    changedFiles: [],
    codeFiles: [],
    dataFiles: [],
    kind: "unknown",
    reason: null,
    versionUrl,
  };

  if (typeof fetchImpl !== "function") {
    return { ...base, reason: "no fetch implementation available to read the live version.json" };
  }

  const { deployedSha, reason } = await fetchDeployedSha({ versionUrl, fetchImpl });

  let headSha = null;
  try {
    headSha = nonEmpty(runGit(["rev-parse", "HEAD"]));
  } catch {
    headSha = null;
  }

  if (!deployedSha) {
    return { ...base, headSha, reason };
  }

  try {
    runGit(["cat-file", "-e", `${deployedSha}^{commit}`]);
  } catch {
    return {
      ...base,
      deployedSha,
      headSha,
      reason: `deployed commit ${shortSha(deployedSha)} is not in local history (fetch it to compare)`,
    };
  }

  let changedFiles = [];
  try {
    const tracked = runGit(["diff", "--name-only", deployedSha, "--"]);
    const untracked = runGit(["ls-files", "--others", "--exclude-standard"]);
    changedFiles = Array.from(new Set([...splitLines(tracked), ...splitLines(untracked)]));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      ...base,
      deployedSha,
      headSha,
      reason: `git diff against ${shortSha(deployedSha)} failed (${message})`,
    };
  }

  const { kind, codeFiles, dataFiles } = classifyPublishDelta({ deployedSha, changedFiles });
  return {
    deployedSha,
    headSha,
    changedFiles,
    codeFiles,
    dataFiles,
    kind,
    reason: null,
    versionUrl,
  };
};

const resolveExecutionPlan = async ({ args, report }) => {
  const indexChanges = hasIndexChanges(report);

  const plan = {
    runIndex: false,
    runBuild: false,
    runDeploy: false,
  };

  if (indexChanges) {
    plan.runIndex = await askYesNo({
      prompt: "Run indexing now?",
      defaultValue: true,
      yes: args.yes,
    });
  }

  if (args.indexOnly) {
    return plan;
  }

  if (args.skipBuild) {
    plan.runBuild = false;
  } else if (args.fastTrack) {
    plan.runBuild = await askYesNo({
      prompt: indexChanges
        ? "If indexing succeeds, build the site afterwards?"
        : "Build the site now?",
      defaultValue: true,
      yes: args.yes,
    });
  }

  if (args.deploy) {
    plan.runDeploy = true;
  } else if (args.skipBuild) {
    plan.runDeploy = false;
  } else if (args.fastTrack && plan.runBuild) {
    plan.runDeploy = await askYesNo({
      prompt: "If the build succeeds, deploy the prebuilt output afterwards?",
      defaultValue: false,
      yes: args.yes,
    });
  }

  return plan;
};

const getVercelPreflightCommand = ({ args, plan }) => {
  if (args.indexOnly) {
    return null;
  }
  // A build or deploy needs a logged-in Vercel CLI. In fast-track mode the plan
  // already knows whether either will run, so we can gate precisely. In
  // interactive mode those choices are made *after* the (possibly multi-hour)
  // index step, so gating on the plan would skip the auth check entirely and
  // only fail at `vercel pull` hours later. Run the check up front whenever a
  // build or deploy could still follow (i.e. the build isn't explicitly
  // skipped, or a deploy was forced with --deploy).
  const buildOrDeployCouldFollow = args.fastTrack
    ? Boolean(plan.runBuild || plan.runDeploy)
    : !args.skipBuild || Boolean(args.deploy);
  return buildOrDeployCouldFollow ? `${VERCEL_CLI} whoami` : null;
};

const openDatabase = (dbPath, Database = sqlite3.Database) => {
  return new Promise((resolve, reject) => {
    const db = new Database(dbPath, sqlite3.OPEN_READONLY, (err) => {
      if (err) {
        reject(err);
        return;
      }
      resolve(db);
    });
  });
};

const dbGet = (db, sql, params = []) => {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) {
        reject(err);
        return;
      }
      resolve(row ?? null);
    });
  });
};

const dbAll = (db, sql, params = []) => {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) {
        reject(err);
        return;
      }
      resolve(rows ?? []);
    });
  });
};

const dbClose = (db) => {
  return new Promise((resolve, reject) => {
    db.close((err) => {
      if (err) {
        reject(err);
        return;
      }
      resolve();
    });
  });
};

const loadEmbeddingsFromDb = async (embeddingsDbPath) => {
  const db = await openDatabase(embeddingsDbPath);
  try {
    const embeddingRows = await dbAll(db, "SELECT path FROM embeddings");
    const embeddingsCountRow = await dbGet(db, "SELECT COUNT(*) AS count FROM embeddings");
    const embeddingModelRows = await dbAll(
      db,
      "SELECT model_id, COUNT(*) AS count FROM embeddings GROUP BY model_id",
    );
    return {
      hasEmbeddingsTable: true,
      embeddingsCount: embeddingsCountRow.count,
      indexedEmbeddingPaths: new Set(embeddingRows.map((row) => row.path)),
      embeddingModelCounts: embeddingModelRows.map((row) => ({
        modelId: row.model_id,
        count: row.count,
      })),
    };
  } finally {
    await dbClose(db);
  }
};

const loadDbState = async (dbPath, embeddingsDbPath = null) => {
  if (!fileExists(dbPath)) {
    return {
      exists: false,
      dbPath,
      imageCount: 0,
      embeddingsCount: 0,
      indexedPhotoPaths: new Set(),
      indexedEmbeddingPaths: new Set(),
      hasEmbeddingsTable: false,
    };
  }

  const db = await openDatabase(dbPath);
  try {
    const imageCountRow = await dbGet(db, "SELECT COUNT(*) AS count FROM images");
    const tableRow = await dbGet(
      db,
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'embeddings'",
    );
    const imageRows = await dbAll(db, "SELECT path FROM images");
    const hasEmbeddingsTable = Boolean(tableRow);
    const embeddingRows = hasEmbeddingsTable ? await dbAll(db, "SELECT path FROM embeddings") : [];
    const embeddingsCountRow = hasEmbeddingsTable
      ? await dbGet(db, "SELECT COUNT(*) AS count FROM embeddings")
      : { count: 0 };
    const embeddingModelRows = hasEmbeddingsTable
      ? await dbAll(db, "SELECT model_id, COUNT(*) AS count FROM embeddings GROUP BY model_id")
      : [];

    const baseState = {
      exists: true,
      dbPath,
      imageCount: imageCountRow.count,
      embeddingsCount: embeddingsCountRow.count,
      indexedPhotoPaths: new Set(imageRows.map((row) => row.path)),
      indexedEmbeddingPaths: new Set(embeddingRows.map((row) => row.path)),
      hasEmbeddingsTable,
      embeddingModelCounts: embeddingModelRows.map((row) => ({
        modelId: row.model_id,
        count: row.count,
      })),
    };

    if (!hasEmbeddingsTable && embeddingsDbPath && fileExists(embeddingsDbPath)) {
      const embeddingsState = await loadEmbeddingsFromDb(embeddingsDbPath);
      return { ...baseState, ...embeddingsState };
    }

    return baseState;
  } finally {
    await dbClose(db);
  }
};

const readAlbumManifestStatus = (albumDir) => {
  const manifestPath = path.join(albumDir, ALBUM_CONFIG_FILENAME);
  if (!fileExists(manifestPath)) {
    return {
      exists: false,
      valid: null,
      errors: [],
    };
  }

  try {
    JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
    return {
      exists: true,
      valid: true,
      errors: [],
    };
  } catch (err) {
    return {
      exists: true,
      valid: false,
      errors: [err instanceof Error ? err.message : String(err)],
    };
  }
};

const readAlbumFiles = (albumDir) => {
  return fs
    .readdirSync(albumDir, { withFileTypes: true })
    .filter((entry) => !entry.isDirectory())
    .map((entry) => entry.name);
};

// A malformed EXIF date must degrade to the benign "missing date" warning, not
// blow up .toISOString() (which throws on an Invalid Date) and get caught below
// as an "unreadable photo" hard blocker.
const toIsoStringOrNull = (value) => {
  if (value == null) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
};

const extractPhotoMetadata = async (filePath) => {
  try {
    const parsed = await exifr.parse(filePath, {
      gps: true,
      exif: true,
      tiff: true,
      ifd0: true,
    });

    const latitude = parsed?.latitude ?? parsed?.lat ?? null;
    const longitude = parsed?.longitude ?? parsed?.lon ?? null;
    const capturedAt =
      parsed?.DateTimeOriginal ?? parsed?.CreateDate ?? parsed?.DateTimeDigitized ?? null;

    return {
      readable: true,
      hasGps: Number.isFinite(latitude) && Number.isFinite(longitude),
      latitude: Number.isFinite(latitude) ? latitude : null,
      longitude: Number.isFinite(longitude) ? longitude : null,
      capturedAt: toIsoStringOrNull(capturedAt),
      warnings: [],
    };
  } catch (err) {
    return {
      readable: false,
      hasGps: false,
      latitude: null,
      longitude: null,
      capturedAt: null,
      warnings: [err instanceof Error ? err.message : String(err)],
    };
  }
};

const buildIndexVerification = ({ discoveredPhotoPaths, newPhotoPaths, dbState }) => {
  const missingPhotoPaths = discoveredPhotoPaths.filter(
    (photoPath) => !dbState.indexedPhotoPaths.has(photoPath),
  );
  const missingNewPhotoPaths = newPhotoPaths.filter(
    (photoPath) => !dbState.indexedPhotoPaths.has(photoPath),
  );
  const missingEmbeddingPaths = dbState.hasEmbeddingsTable
    ? newPhotoPaths.filter((photoPath) => !dbState.indexedEmbeddingPaths.has(photoPath))
    : [];

  const blockers = [];
  const warnings = [];

  if (!dbState.exists) {
    blockers.push("search.sqlite is missing after indexing");
  }
  if (missingPhotoPaths.length > 0) {
    blockers.push(
      `${missingPhotoPaths.length} discovered photos are missing from the images table`,
    );
  }
  if (dbState.hasEmbeddingsTable && missingEmbeddingPaths.length > 0) {
    warnings.push(`${missingEmbeddingPaths.length} newly discovered photos are missing embeddings`);
  }
  if (dbState.hasEmbeddingsTable && dbState.embeddingsCount < dbState.imageCount) {
    warnings.push(
      `embeddings table has fewer rows than images (${dbState.embeddingsCount}/${dbState.imageCount})`,
    );
  }

  return {
    imageCount: dbState.imageCount,
    embeddingsCount: dbState.embeddingsCount,
    discoveredPhotoCount: discoveredPhotoPaths.length,
    newPhotoCount: newPhotoPaths.length,
    missingPhotoPaths,
    missingNewPhotoPaths,
    missingEmbeddingPaths,
    indexedCoveragePercent:
      discoveredPhotoPaths.length === 0
        ? 100
        : ((discoveredPhotoPaths.length - missingPhotoPaths.length) / discoveredPhotoPaths.length) *
          100,
    newPhotoCoveragePercent:
      newPhotoPaths.length === 0
        ? 100
        : ((newPhotoPaths.length - missingNewPhotoPaths.length) / newPhotoPaths.length) * 100,
    newEmbeddingCoveragePercent:
      !dbState.hasEmbeddingsTable || newPhotoPaths.length === 0
        ? null
        : ((newPhotoPaths.length - missingEmbeddingPaths.length) / newPhotoPaths.length) * 100,
    blockers,
    warnings,
    ok: blockers.length === 0,
  };
};

const buildSummary = (albums) => {
  const summary = {
    totalAlbums: albums.length,
    totalPhotos: 0,
    totalVideos: 0,
    newPhotos: 0,
    removedPhotos: 0,
    photosWithGps: 0,
    photosWithoutGps: 0,
    photosMissingExifDate: 0,
    unreadablePhotos: 0,
    invalidAlbums: 0,
    totalWarnings: 0,
    totalBlockers: 0,
  };

  for (const album of albums) {
    summary.totalPhotos += album.photos.length;
    summary.totalVideos += album.videos.length;
    summary.newPhotos += album.newPhotos.length;
    summary.removedPhotos += album.removedPhotos.length;
    summary.invalidAlbums += album.manifest.exists && album.manifest.valid === false ? 1 : 0;
    summary.totalWarnings += album.warnings.length;
    summary.totalBlockers += album.blockers.length;

    for (const photo of album.newPhotos) {
      if (!photo.metadata.readable) {
        summary.unreadablePhotos += 1;
        continue;
      }
      if (photo.metadata.hasGps) {
        summary.photosWithGps += 1;
      } else {
        summary.photosWithoutGps += 1;
      }
      if (!photo.metadata.capturedAt) {
        summary.photosMissingExifDate += 1;
      }
    }
  }

  return summary;
};

const createAlbumReport = async ({ albumDir, albumName, dbState }) => {
  const manifest = readAlbumManifestStatus(albumDir);
  const files = readAlbumFiles(albumDir);
  const zoneSidecars = files.filter(isZoneIdentifierFile);
  const photos = files.filter(isPhotoFile);
  const videos = files.filter(isVideoFile);

  const photoPaths = photos.map((filename) =>
    toPosixPath(path.join("../albums", albumName, filename)),
  );
  const newPhotoNames = photos.filter((filename) => {
    const relativePath = toPosixPath(path.join("../albums", albumName, filename));
    return !dbState.indexedPhotoPaths.has(relativePath);
  });

  const removedPhotos = Array.from(dbState.indexedPhotoPaths)
    .filter((indexedPath) => indexedPath.startsWith(`../albums/${albumName}/`))
    .filter((indexedPath) => !photoPaths.includes(indexedPath));

  const newPhotos = [];
  for (const filename of newPhotoNames) {
    const absolutePath = path.join(albumDir, filename);
    const metadata = await extractPhotoMetadata(absolutePath);
    newPhotos.push({
      filename,
      path: toPosixPath(path.join("../albums", albumName, filename)),
      absolutePath,
      metadata,
    });
  }

  const warnings = [];
  const blockers = [];

  if (manifest.exists && manifest.valid === false) {
    blockers.push(`album.json is invalid for ${albumName}`);
  }
  if (zoneSidecars.length > 0) {
    warnings.push(`${zoneSidecars.length} Zone.Identifier sidecar files found`);
  }
  if (photos.length === 0 && videos.length === 0) {
    warnings.push("album has no media files");
  }
  if (newPhotos.some((photo) => !photo.metadata.readable)) {
    blockers.push("one or more new photos could not be read for EXIF/GPS metadata");
  }

  return {
    albumName,
    albumDir,
    manifest,
    zoneSidecars,
    photos,
    photoPaths,
    videos,
    newPhotos,
    removedPhotos,
    warnings,
    blockers,
  };
};

// createAlbumReport only runs for directories that still exist on disk, so a
// whole-album deletion is otherwise invisible: its rows stay in the search DB
// forever (searchable, with broken links) because prune never runs. Surface
// each vanished album as a synthetic report whose indexed photos are all
// "removed", which feeds removedPhotos and triggers the index/prune step.
const buildDeletedAlbumReports = ({ indexedPhotoPaths, onDiskAlbumNames }) => {
  const onDisk = new Set(onDiskAlbumNames);
  const removedByAlbum = new Map();

  for (const indexedPath of indexedPhotoPaths) {
    const match = /^\.\.\/albums\/([^/]+)\//.exec(indexedPath);
    if (!match) continue;
    const albumName = match[1];
    if (onDisk.has(albumName)) continue;
    if (!removedByAlbum.has(albumName)) {
      removedByAlbum.set(albumName, []);
    }
    removedByAlbum.get(albumName).push(indexedPath);
  }

  return Array.from(removedByAlbum, ([albumName, removedPhotos]) => ({
    albumName,
    albumDir: null,
    manifest: { exists: false, valid: null, errors: [] },
    zoneSidecars: [],
    photos: [],
    photoPaths: [],
    videos: [],
    newPhotos: [],
    removedPhotos,
    warnings: [
      `album directory no longer exists on disk (${removedPhotos.length} indexed photo(s) will be pruned)`,
    ],
    blockers: [],
  }));
};

const getIndexerModelInfo = (indexDir, run, warn) => {
  try {
    const output = run("uv run index.py model-info", { cwd: indexDir, timeout: 10000 });
    return JSON.parse(output.toString().trim());
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    warn(
      styleText(
        `Warning: could not query the indexer's embedding models (${reason}). Embedding coverage and model-change checks will be skipped for this run.`,
        ANSI.yellow,
      ),
    );
    return null;
  }
};

const readLastIndexStats = (lastIndexStatsPath) => {
  if (!lastIndexStatsPath || !fileExists(lastIndexStatsPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(lastIndexStatsPath, "utf-8"));
  } catch {
    return null;
  }
};

const createPreflightReport = async ({
  albumsDir,
  dbPath,
  embeddingsDbPath,
  indexDir,
  lastIndexStatsPath,
  repoDir,
  deployedVersionUrl,
  loadState = loadDbState,
  getModelInfo = getIndexerModelInfo,
  resolveDelta = resolveDeploymentDelta,
  now = () => new Date(),
}) => {
  const dbState = await loadState(dbPath, embeddingsDbPath);
  const albumNames = fs
    .readdirSync(albumsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter(shouldIncludeAlbum)
    .sort();

  const albums = [];
  for (const albumName of albumNames) {
    const albumDir = path.join(albumsDir, albumName);
    albums.push(await createAlbumReport({ albumDir, albumName, dbState }));
  }
  albums.push(
    ...buildDeletedAlbumReports({
      indexedPhotoPaths: dbState.indexedPhotoPaths,
      onDiskAlbumNames: albumNames,
    }),
  );

  const modelInfo = indexDir ? getModelInfo(indexDir, execSync, console.warn) : null;
  const expectedEmbeddingModelIds =
    modelInfo?.embeddingModelIds ??
    (modelInfo?.embeddingModelId ? [modelInfo.embeddingModelId] : []);
  const currentEmbeddingModelId = modelInfo?.embeddingModelId ?? null;
  // Stale = rows under model IDs the indexer no longer produces. These won't be
  // re-embedded automatically (the indexer skips paths that already have a row
  // under any of its current IDs), so they linger until the DB is rebuilt.
  const staleModels =
    expectedEmbeddingModelIds.length > 0
      ? dbState.embeddingModelCounts.filter((m) => !expectedEmbeddingModelIds.includes(m.modelId))
      : [];
  const staleEmbeddingCount = staleModels.reduce((sum, m) => sum + m.count, 0);
  const staleEmbeddingModelIds = staleModels.map((m) => m.modelId);
  // Missing = photos that don't have full coverage across every expected model.
  // Take the min count across the expected set — if any expected model is
  // absent from the DB its count is 0, so missing == imageCount.
  const missingEmbeddingCount =
    expectedEmbeddingModelIds.length > 0
      ? Math.max(
          0,
          dbState.imageCount -
            Math.min(
              ...expectedEmbeddingModelIds.map(
                (id) => dbState.embeddingModelCounts.find((m) => m.modelId === id)?.count ?? 0,
              ),
            ),
        )
      : 0;
  const unexpectedEmbeddingModels = staleModels;

  const deployment = repoDir
    ? await resolveDelta({
        repoDir,
        versionUrl: deployedVersionUrl ?? getDeployedVersionUrl(),
      })
    : null;

  return {
    generatedAt: now().toISOString(),
    deployment,
    db: {
      exists: dbState.exists,
      path: dbState.dbPath,
      imageCount: dbState.imageCount,
      embeddingsCount: dbState.embeddingsCount,
      hasEmbeddingsTable: dbState.hasEmbeddingsTable,
      expectedEmbeddingModelIds,
      currentEmbeddingModelId,
      staleEmbeddingCount,
      staleEmbeddingModelIds,
      missingEmbeddingCount,
      unexpectedEmbeddingModels,
    },
    lastIndexStats: readLastIndexStats(lastIndexStatsPath),
    albums,
    summary: buildSummary(albums),
  };
};

const writeReport = (reportPath, report) => {
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf-8");
};

const askYesNo = async ({ prompt, defaultValue, yes }) => {
  if (yes) {
    return defaultValue;
  }

  const rl = readline.createInterface({ input: stdin, output: stdout });
  try {
    const suffix = defaultValue ? "[Y/n]" : "[y/N]";
    const answer = (await rl.question(`${prompt} ${suffix} `)).trim().toLowerCase();
    if (!answer) {
      return defaultValue;
    }
    return answer === "y" || answer === "yes";
  } finally {
    rl.close();
  }
};

const wallClockStamp = () => {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? "+" : "-";
  const oh = pad(Math.floor(Math.abs(off) / 60));
  const om = pad(Math.abs(off) % 60);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}${sign}${oh}:${om}`;
};

const runShellCommand = ({
  command,
  cwd,
  spawnImpl = spawn,
  now = Date.now,
  log = console.log,
}) => {
  return new Promise((resolve, reject) => {
    const startedAt = now();
    log(`\n[${wallClockStamp()}] ${statusLabel("run")} ${command}`);
    const child = spawnImpl(command, {
      cwd,
      stdio: "inherit",
      shell: true,
      env: process.env,
    });

    child.on("exit", (code) => {
      if (code === 0) {
        const elapsedSeconds = ((now() - startedAt) / 1000).toFixed(1);
        log(`[${wallClockStamp()}] ${statusLabel("ok")} Finished in ${elapsedSeconds}s`);
        resolve();
        return;
      }
      reject(new Error(`Command failed (${code}): ${command}`));
    });
    child.on("error", reject);
  });
};

const printPreflightReport = (report) => {
  const { summary } = report;
  const attentionAlbums = buildAttentionAlbums(report);

  printSection("Photo Publish Preflight");
  printStatRows([
    { label: "Albums scanned", value: formatNumber(summary.totalAlbums), level: "info" },
    { label: "Photos on disk", value: formatNumber(summary.totalPhotos), level: "info" },
    { label: "Videos on disk", value: formatNumber(summary.totalVideos), level: "info" },
    {
      label: "New photos",
      value: formatNumber(summary.newPhotos),
      level: summary.newPhotos > 0 ? "warn" : "ok",
    },
    {
      label: "Removed photos",
      value: formatNumber(summary.removedPhotos),
      level: summary.removedPhotos > 0 ? "warn" : "ok",
    },
    {
      label: "New photos with GPS",
      value: formatNumber(summary.photosWithGps),
      level: "ok",
    },
    {
      label: "New photos without GPS",
      value: formatNumber(summary.photosWithoutGps),
      level: summary.photosWithoutGps > 0 ? "warn" : "ok",
    },
    {
      label: "New photos missing date",
      value: formatNumber(summary.photosMissingExifDate),
      level: summary.photosMissingExifDate > 0 ? "warn" : "ok",
    },
    {
      label: "Unreadable new photos",
      value: formatNumber(summary.unreadablePhotos),
      level: summary.unreadablePhotos > 0 ? "block" : "ok",
    },
    {
      label: "Invalid album.json",
      value: formatNumber(summary.invalidAlbums),
      level: summary.invalidAlbums > 0 ? "block" : "ok",
    },
  ]);

  printSection("Preflight Insights");
  printInsightLines(buildPreflightInsights(report));

  if (report.deployment) {
    printSection("Publish Type");
    printInsightLines([buildDeploymentInsight(report.deployment)]);
    if (report.deployment.kind === "code" && report.deployment.codeFiles.length > 0) {
      const preview = report.deployment.codeFiles.slice(0, 8);
      printIndentedList(preview);
      if (report.deployment.codeFiles.length > preview.length) {
        printIndentedList([
          `... ${formatNumber(report.deployment.codeFiles.length - preview.length)} more changed source file(s)`,
        ]);
      }
    }
  }

  printSection("Albums Needing Attention");
  if (attentionAlbums.length === 0) {
    printInsightLines([{ level: "ok", text: "No album-level issues detected." }]);
    return;
  }

  for (const album of attentionAlbums) {
    const parts = [];
    if (album.newPhotos.length > 0) {
      parts.push(`new ${formatNumber(album.newPhotos.length)}`);
    }
    if (album.removedPhotos.length > 0) {
      parts.push(`removed ${formatNumber(album.removedPhotos.length)}`);
    }
    if (album.diagnostics.photosWithoutGps > 0) {
      parts.push(`no-gps ${formatNumber(album.diagnostics.photosWithoutGps)}`);
    }
    if (album.diagnostics.photosMissingExifDate > 0) {
      parts.push(`no-date ${formatNumber(album.diagnostics.photosMissingExifDate)}`);
    }
    if (album.diagnostics.unreadablePhotos > 0) {
      parts.push(`unreadable ${formatNumber(album.diagnostics.unreadablePhotos)}`);
    }

    const level = album.blockers.length > 0 ? "block" : album.warnings.length > 0 ? "warn" : "info";
    console.log(
      `  ${statusLabel(level)} ${album.albumName}${parts.length > 0 ? `  (${parts.join(", ")})` : ""}`,
    );

    if (album.newPhotos.length > 0) {
      const preview = album.newPhotos.slice(0, 5).map((photo) => {
        const tags = [photo.metadata.hasGps ? "gps" : "no-gps"];
        if (!photo.metadata.capturedAt) {
          tags.push("no-date");
        }
        if (!photo.metadata.readable) {
          tags.push("unreadable");
        }
        return `${photo.filename} [${tags.join(", ")}]`;
      });
      printIndentedList(preview);
      if (album.newPhotos.length > preview.length) {
        printIndentedList([
          `... ${formatNumber(album.newPhotos.length - preview.length)} more new photo(s)`,
        ]);
      }
    }
    if (album.removedPhotos.length > 0) {
      printIndentedList([
        `${formatNumber(album.removedPhotos.length)} indexed photo(s) no longer exist on disk`,
      ]);
    }
    if (album.warnings.length > 0) {
      printIndentedList(album.warnings, "    ! ");
    }
    if (album.blockers.length > 0) {
      printIndentedList(album.blockers, "    x ");
    }
  }
};

const printVerificationReport = (verification) => {
  printSection("Index Verification");
  printStatRows([
    { label: "Images rows", value: formatNumber(verification.imageCount), level: "info" },
    {
      label: "Embeddings rows",
      value: formatNumber(verification.embeddingsCount),
      level: verification.embeddingsCount < verification.imageCount ? "warn" : "ok",
    },
    {
      label: "Indexed coverage",
      value: formatPercent(verification.indexedCoveragePercent),
      level: verification.ok ? "ok" : "block",
    },
  ]);
  printSection("Verification Insights");
  printInsightLines(buildVerificationInsights(verification));

  if (verification.missingNewPhotoPaths.length > 0) {
    console.log(
      `  ${statusLabel("block")} Missing new photos in index: ${formatNumber(verification.missingNewPhotoPaths.length)}`,
    );
    for (const photoPath of verification.missingNewPhotoPaths.slice(0, 10)) {
      console.log(`  ${photoPath}`);
    }
  }
  if (verification.missingEmbeddingPaths.length > 0) {
    console.log(
      `  ${statusLabel("warn")} Missing embeddings for new photos: ${formatNumber(verification.missingEmbeddingPaths.length)}`,
    );
  }
};

const formatDuration = (seconds) => {
  if (seconds < 90) return `~${Math.round(seconds)}s`;
  if (seconds < 3600) return `~${Math.round(seconds / 60)}min`;
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  return `~${h}h ${m}min`;
};

const describeDeploymentPlanRow = (deployment) => {
  if (!deployment) {
    return null;
  }
  if (deployment.kind === "code") {
    return {
      label: "Publish type",
      value: `JS/code + data (${formatNumber(deployment.codeFiles.length)} source file(s) changed)`,
      level: "info",
    };
  }
  if (deployment.kind === "data-only") {
    return { label: "Publish type", value: "data only (no code changes)", level: "ok" };
  }
  return { label: "Publish type", value: "unknown (could not read live version)", level: "warn" };
};

const printExecutionPlan = ({ args, report, plan }) => {
  const indexChanges = hasIndexChanges(report);

  const stats = report.lastIndexStats;
  const indexWorkItems = (report.summary.newPhotos ?? 0) + (report.db.missingEmbeddingCount ?? 0);
  const estimatedIndexSeconds =
    stats?.medianAnalysisMs && indexWorkItems > 0
      ? (indexWorkItems * stats.medianAnalysisMs) / 1000
      : null;

  const deploymentRow = describeDeploymentPlanRow(report.deployment);

  printSection("Execution Plan");
  printStatRows([
    {
      label: "Mode",
      value: args.fastTrack ? "fast-track (default)" : "interactive",
      level: "info",
    },
    ...(deploymentRow ? [deploymentRow] : []),
    {
      label: "Index update",
      value: indexChanges ? (plan.runIndex ? "yes" : "no") : "not needed",
      level: indexChanges ? (plan.runIndex ? "ok" : "warn") : "info",
    },
    ...(estimatedIndexSeconds !== null && plan.runIndex
      ? [
          {
            label: "Estimated index time",
            value: `${formatDuration(estimatedIndexSeconds)} (${formatNumber(indexWorkItems)} photos × ${Math.round(stats.medianAnalysisMs)}ms/photo from last run)`,
            level: "info",
          },
        ]
      : []),
    {
      label: "Build",
      value: args.skipBuild
        ? "skipped by flag"
        : args.fastTrack
          ? plan.runBuild
            ? "yes"
            : "no"
          : "decide later",
      level: args.skipBuild ? "warn" : plan.runBuild ? "ok" : "info",
    },
    {
      label: "Deploy",
      value: args.deploy
        ? "yes (forced by --deploy)"
        : args.fastTrack
          ? plan.runDeploy
            ? "yes"
            : "no"
          : "decide later",
      level: args.deploy || plan.runDeploy ? "ok" : "info",
    },
  ]);
};

const buildWizardContext = ({ srcDir }) => {
  const repoDir = path.resolve(srcDir, "..");
  const indexDir = path.join(repoDir, "index");
  return {
    srcDir,
    repoDir,
    albumsDir: path.join(repoDir, "albums"),
    indexDir,
    lastIndexStatsPath: path.join(indexDir, ".last-index-stats.json"),
    dbPath: path.join(srcDir, "public", "search.sqlite"),
    embeddingsDbPath: path.join(srcDir, "public", "search-embeddings.sqlite"),
    reportPath: path.join(srcDir, REPORT_FILENAME),
  };
};

module.exports = {
  ALBUM_CONFIG_FILENAME,
  REPORT_FILENAME,
  askYesNo,
  buildDeletedAlbumReports,
  buildDeploymentInsight,
  buildIndexVerification,
  buildSummary,
  buildWizardContext,
  buildVerificationInsights,
  classifyPublishDelta,
  createAlbumReport,
  createPreflightReport,
  calculateAlbumDiagnostics,
  buildAttentionAlbums,
  buildPreflightInsights,
  dbAll,
  dbClose,
  dbGet,
  defaultRunGit,
  describeDeploymentPlanRow,
  extractPhotoMetadata,
  fetchDeployedSha,
  fileExists,
  formatDuration,
  formatNumber,
  formatPercent,
  getIndexerModelInfo,
  getDeployedVersionUrl,
  getVercelPreflightCommand,
  hasIndexChanges,
  isDataPath,
  isPhotoFile,
  isVideoFile,
  isZoneIdentifierFile,
  loadDbState,
  nonEmpty,
  openDatabase,
  parseArgs,
  printIndentedList,
  printInsightLines,
  printExecutionPlan,
  printPreflightReport,
  printSection,
  printStatRows,
  printVerificationReport,
  readAlbumFiles,
  readAlbumManifestStatus,
  readLastIndexStats,
  resolveDeploymentDelta,
  resolveExecutionPlan,
  runShellCommand,
  shortSha,
  splitLines,
  statusLabel,
  styleText,
  toIsoStringOrNull,
  toPosixPath,
  wallClockStamp,
  writeReport,
};
