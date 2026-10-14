// Windows writes `<file>:Zone.Identifier` beside anything copied out of a
// download into WSL. The build ignores them and never deletes sources, so
// removing them is an explicit choice: `album doctor --fix`.

const fs = require("node:fs");
const path = require("node:path");

const isZoneSidecar = (filename) => filename.toLowerCase().endsWith(":zone.identifier");

const findZoneSidecars = (albumsDir) => {
  let entries;
  try {
    entries = fs.readdirSync(albumsDir, { recursive: true, withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((entry) => entry.isFile() && isZoneSidecar(entry.name))
    .map((entry) => path.join(entry.parentPath, entry.name));
};

const removeZoneSidecars = (paths) => {
  const removed = [];
  const failed = [];
  for (const file of paths) {
    if (!isZoneSidecar(path.basename(file))) continue;
    try {
      fs.unlinkSync(file);
      removed.push(file);
    } catch (error) {
      failed.push({ file, message: error instanceof Error ? error.message : String(error) });
    }
  }
  return { removed, failed };
};

module.exports = { findZoneSidecars, isZoneSidecar, removeZoneSidecars };
