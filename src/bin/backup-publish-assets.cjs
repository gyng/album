#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

const DEFAULT_DB_FILENAMES = ["search.sqlite", "search-embeddings.sqlite"];

const formatTimestamp = (date = new Date()) => {
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}-${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`;
};

const parseArgs = (argv) => {
  const args = {
    outDir: null,
    withAlbums: false,
    withDb: true,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    switch (token) {
      case "--out":
      case "-o": {
        const value = argv[index + 1];
        if (!value) {
          throw new Error("Missing value for --out");
        }
        args.outDir = value;
        index += 1;
        break;
      }
      case "--with-albums":
        args.withAlbums = true;
        break;
      case "--albums-only":
        args.withAlbums = true;
        args.withDb = false;
        break;
      case "--db-only":
        args.withAlbums = false;
        args.withDb = true;
        break;
      case "--help":
      case "-h":
        args.help = true;
        break;
      default:
        throw new Error(`Unknown argument: ${token}`);
    }
  }

  return args;
};

const ensureDir = (dirPath) => {
  fs.mkdirSync(dirPath, { recursive: true });
};

const fileExists = (filePath) => {
  try {
    fs.accessSync(filePath, fs.constants.F_OK);
    return true;
  } catch {
    return false;
  }
};

const printHelp = () => {
  console.log(`Backup publish assets (databases and optional albums).

Usage:
  node ./bin/backup-publish-assets.cjs [options]

Options:
  -o, --out <dir>   Destination root (default: ../backups)
  --with-albums     Include ../albums in the backup
  --db-only         Backup databases only (default)
  --albums-only     Backup albums only
  -h, --help        Show this help
`);
};

const run = ({ srcDir, argv }) => {
  const repoDir = path.resolve(srcDir, "..");
  const publicDir = path.join(srcDir, "public");
  const albumsDir = path.join(repoDir, "albums");

  const args = parseArgs(argv);
  if (args.help) {
    printHelp();
    return;
  }

  const backupRoot = path.resolve(repoDir, args.outDir ?? "backups");
  const snapshotName = `publish-backup-${formatTimestamp()}`;
  const snapshotDir = path.join(backupRoot, snapshotName);
  const dbBackupDir = path.join(snapshotDir, "db");
  const albumsBackupDir = path.join(snapshotDir, "albums");

  ensureDir(snapshotDir);

  const copiedFiles = [];
  const missingFiles = [];

  if (args.withDb) {
    ensureDir(dbBackupDir);
    for (const filename of DEFAULT_DB_FILENAMES) {
      const sourcePath = path.join(publicDir, filename);
      if (!fileExists(sourcePath)) {
        missingFiles.push(sourcePath);
        continue;
      }
      const destinationPath = path.join(dbBackupDir, filename);
      fs.copyFileSync(sourcePath, destinationPath);
      copiedFiles.push({ from: sourcePath, to: destinationPath });
    }
  }

  if (args.withAlbums) {
    if (!fileExists(albumsDir)) {
      throw new Error(`Albums directory does not exist: ${albumsDir}`);
    }
    fs.cpSync(albumsDir, albumsBackupDir, { recursive: true, force: false });
    copiedFiles.push({ from: albumsDir, to: albumsBackupDir });
  }

  if (copiedFiles.length === 0) {
    throw new Error("Nothing was copied. Check your options and source files.");
  }

  const manifest = {
    createdAt: new Date().toISOString(),
    snapshotDir,
    options: {
      withDb: args.withDb,
      withAlbums: args.withAlbums,
    },
    copiedFiles,
    missingFiles,
  };
  const manifestPath = path.join(snapshotDir, "manifest.json");
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf-8");

  console.log(`Backup created at ${snapshotDir}`);
  console.log(`Copied ${copiedFiles.length} item(s)`);
  if (missingFiles.length > 0) {
    console.log(`Missing ${missingFiles.length} item(s):`);
    for (const missingPath of missingFiles) {
      console.log(`- ${missingPath}`);
    }
  }
};

module.exports = {
  parseArgs,
  run,
};

if (require.main === module) {
  try {
    run({ srcDir: path.resolve(__dirname, ".."), argv: process.argv.slice(2) });
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  }
}
