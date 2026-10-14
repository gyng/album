/** @jest-environment node */

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { findZoneSidecars, removeZoneSidecars } = require("./zoneSidecars.cjs");

const makeAlbums = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "album-zone-"));
  const write = (relative, contents = "x") => {
    const file = path.join(root, relative);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, contents);
    return file;
  };
  return { root, write };
};

describe("Zone.Identifier sidecars", () => {
  it("finds sidecars at any depth and nothing else", () => {
    const { root, write } = makeAlbums();
    const top = write("trip/photo.jpg:Zone.Identifier");
    const nested = write("trip/nested/clip.MOV:zone.identifier");
    write("trip/photo.jpg");
    write("trip/Zone.Identifier.notes.txt");
    write("trip/photo.jpg:Zone.Identifier.bak");

    expect(findZoneSidecars(root).sort()).toEqual([nested, top].sort());
  });

  it("returns nothing for a missing albums directory", () => {
    expect(findZoneSidecars(path.join(os.tmpdir(), "no-such-albums-dir"))).toEqual([]);
  });

  it("removes only the sidecars and leaves the photographs", () => {
    const { root, write } = makeAlbums();
    const photo = write("trip/photo.jpg");
    const sidecar = write("trip/photo.jpg:Zone.Identifier");

    expect(removeZoneSidecars(findZoneSidecars(root))).toEqual({ removed: [sidecar], failed: [] });
    expect(fs.existsSync(sidecar)).toBe(false);
    expect(fs.existsSync(photo)).toBe(true);
  });

  it("refuses to remove a path that is not a sidecar", () => {
    const { write } = makeAlbums();
    const photo = write("trip/photo.jpg");

    expect(removeZoneSidecars([photo]).removed).toEqual([]);
    expect(fs.existsSync(photo)).toBe(true);
  });
});
