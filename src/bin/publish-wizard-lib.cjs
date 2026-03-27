const fs = require("fs");
const path = require("path");
const readline = require("readline/promises");
const { stdin, stdout } = require("process");
const { spawn } = require("child_process");
const exifr = require("exifr");
const sqlite3 = require("sqlite3");

const PHOTO_EXTENSIONS = new Set([".jpg", ".jpeg"]);
const VIDEO_EXTENSIONS = new Set([
  ".mp4",
  ".mov",
  ".m4v",
  ".webm",
  ".mkv",
  ".avi",
]);
const ALBUM_CONFIG_FILENAME = "album.json";
const REPORT_FILENAME = ".publish-report.json";

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

const isPhotoFile = (filename) =>
  PHOTO_EXTENSIONS.has(path.extname(filename).toLowerCase());

const isVideoFile = (filename) =>
  VIDEO_EXTENSIONS.has(path.extname(filename).toLowerCase());

const isZoneIdentifierFile = (filename) =>
  filename.toLowerCase().includes(":zone.identifier");

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

  if (lines.length === 0) {
    lines.push({ level: "ok", text: "Preflight checks are clean." });
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
      const leftScore = left.blockers.length * 100 + left.warnings.length * 10 + left.newPhotos.length;
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

const resolveExecutionPlan = async ({ args, report }) => {
  const hasIndexChanges = report.summary.newPhotos > 0 || report.summary.removedPhotos > 0;

  const plan = {
    runIndex: false,
    runBuild: false,
    runDeploy: false,
  };

  if (hasIndexChanges) {
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
      prompt: hasIndexChanges
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

const openDatabase = (dbPath) => {
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(dbPath, sqlite3.OPEN_READONLY, (err) => {
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

const loadDbState = async (dbPath) => {
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
    const embeddingRows = hasEmbeddingsTable
      ? await dbAll(db, "SELECT path FROM embeddings")
      : [];
    const embeddingsCountRow = hasEmbeddingsTable
      ? await dbGet(db, "SELECT COUNT(*) AS count FROM embeddings")
      : { count: 0 };

    return {
      exists: true,
      dbPath,
      imageCount: imageCountRow?.count ?? 0,
      embeddingsCount: embeddingsCountRow?.count ?? 0,
      indexedPhotoPaths: new Set(imageRows.map((row) => row.path)),
      indexedEmbeddingPaths: new Set(embeddingRows.map((row) => row.path)),
      hasEmbeddingsTable,
    };
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
      capturedAt:
        capturedAt instanceof Date
          ? capturedAt.toISOString()
          : capturedAt
            ? new Date(capturedAt).toISOString()
            : null,
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

const buildIndexVerification = ({
  discoveredPhotoPaths,
  newPhotoPaths,
  dbState,
}) => {
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
    blockers.push(`${missingPhotoPaths.length} discovered photos are missing from the images table`);
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
        : ((discoveredPhotoPaths.length - missingPhotoPaths.length) / discoveredPhotoPaths.length) * 100,
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

const createPreflightReport = async ({ albumsDir, dbPath }) => {
  const dbState = await loadDbState(dbPath);
  const albumNames = fs
    .readdirSync(albumsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

  const albums = [];
  for (const albumName of albumNames) {
    const albumDir = path.join(albumsDir, albumName);
    albums.push(await createAlbumReport({ albumDir, albumName, dbState }));
  }

  return {
    generatedAt: new Date().toISOString(),
    db: {
      exists: dbState.exists,
      path: dbState.dbPath,
      imageCount: dbState.imageCount,
      embeddingsCount: dbState.embeddingsCount,
      hasEmbeddingsTable: dbState.hasEmbeddingsTable,
    },
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

const runShellCommand = ({ command, cwd }) => {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    console.log(`\n${statusLabel("run")} ${command}`);
    const child = spawn(command, {
      cwd,
      stdio: "inherit",
      shell: true,
      env: process.env,
    });

    child.on("exit", (code) => {
      if (code === 0) {
        const elapsedSeconds = ((Date.now() - startedAt) / 1000).toFixed(1);
        console.log(`${statusLabel("ok")} Finished in ${elapsedSeconds}s`);
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
    { label: "New photos", value: formatNumber(summary.newPhotos), level: summary.newPhotos > 0 ? "warn" : "ok" },
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
    console.log(`  ${statusLabel(level)} ${album.albumName}${parts.length > 0 ? `  (${parts.join(", ")})` : ""}`);

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
        printIndentedList([`... ${formatNumber(album.newPhotos.length - preview.length)} more new photo(s)`]);
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
    console.log(`  ${statusLabel("block")} Missing new photos in index: ${formatNumber(verification.missingNewPhotoPaths.length)}`);
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

const printExecutionPlan = ({ args, report, plan }) => {
  const hasIndexChanges = report.summary.newPhotos > 0 || report.summary.removedPhotos > 0;

  printSection("Execution Plan");
  printStatRows([
    {
      label: "Mode",
      value: args.fastTrack ? "fast-track (default)" : "interactive",
      level: "info",
    },
    {
      label: "Index update",
      value: hasIndexChanges ? (plan.runIndex ? "yes" : "no") : "not needed",
      level: hasIndexChanges ? (plan.runIndex ? "ok" : "warn") : "info",
    },
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
  return {
    srcDir,
    repoDir,
    albumsDir: path.join(repoDir, "albums"),
    dbPath: path.join(srcDir, "public", "search.sqlite"),
    reportPath: path.join(srcDir, REPORT_FILENAME),
  };
};

module.exports = {
  ALBUM_CONFIG_FILENAME,
  REPORT_FILENAME,
  buildIndexVerification,
  buildSummary,
  buildWizardContext,
  createPreflightReport,
  buildAttentionAlbums,
  buildPreflightInsights,
  loadDbState,
  parseArgs,
  printExecutionPlan,
  printPreflightReport,
  printVerificationReport,
  resolveExecutionPlan,
  runShellCommand,
  askYesNo,
  buildVerificationInsights,
  writeReport,
};
