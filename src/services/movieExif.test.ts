import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readMovieExif } from "./movieExif";

// The committed X-T5 fixture is a real clip, and these are the readings
// exiftool reports for it: the camera-local wall clock, the zone the camera was
// set to, and the coordinates it was shot at.
const FIXTURE = path.join(__dirname, "..", "..", "albums", "test-simple", "DSCF0159.MOV");

const atom = (type: string, payload: Buffer): Buffer => {
  const header = Buffer.alloc(8);
  header.writeUInt32BE(payload.length + 8, 0);
  header.write(type, 4, "latin1");
  return Buffer.concat([header, payload]);
};

const entry = (tag: number, type: number, count: number, value: number | string): Buffer => {
  const bytes = Buffer.alloc(12);
  bytes.writeUInt16LE(tag, 0);
  bytes.writeUInt16LE(type, 2);
  bytes.writeUInt32LE(count, 4);
  if (typeof value === "string") {
    bytes.write(value, 8, "latin1");
  } else {
    bytes.writeUInt32LE(value, 8);
  }
  return bytes;
};

const rational = (numerator: number, denominator: number): Buffer => {
  const bytes = Buffer.alloc(8);
  bytes.writeUInt32LE(numerator, 0);
  bytes.writeUInt32LE(denominator, 4);
  return bytes;
};

const ifd = (entries: Buffer[]): Buffer => {
  const count = Buffer.alloc(2);
  count.writeUInt16LE(entries.length, 0);
  const next = Buffer.alloc(4);
  return Buffer.concat([count, ...entries, next]);
};

type Readings = {
  date: string;
  lat: readonly [number, number, number];
  lng: readonly [number, number, number];
};

/**
 * A stand-in for Fuji's `MVTG` atom: `base` bytes of header, then an IFD0
 * pointing at an Exif IFD and a GPS IFD, with every value offset counted from
 * `base` — which is what makes a payload whose own header is 16 bytes (Fuji)
 * and one that opens with an 8-byte TIFF header both parse.
 */
const tagPayload = (readings: Readings, base: number): Buffer => {
  const dateBytes = Buffer.from(`${readings.date}\u0000`, "latin1");
  const offsetBytes = Buffer.from("+09:00\u0000", "latin1");
  const ifd0Bytes = 2 + 3 * 12 + 4;
  // Fuji's payload counts value offsets from its own header, which is also
  // where its IFD starts; a TIFF payload counts them from byte zero, so the
  // header's length is added as well.
  const offsetsBase = base === 8 ? base : 0;
  const at = (relative: number) => offsetsBase + relative;

  const date1 = ifd0Bytes;
  const exifIfd = date1 + dateBytes.length;
  const date2 = exifIfd + (2 + 2 * 12 + 4);
  const offsetTime = date2 + dateBytes.length;
  const gpsIfd = offsetTime + offsetBytes.length;
  const coordinates = gpsIfd + (2 + 4 * 12 + 4);

  const header = Buffer.alloc(base);
  if (base === 8) {
    // TIFF header: little-endian magic, IFD0 immediately after it.
    header.write("II*\u0000", 0, "latin1");
    header.writeUInt32LE(base, 4);
  }

  return Buffer.concat([
    header,
    ifd([
      entry(0x0132, 2, dateBytes.length, at(date1)),
      entry(0x8769, 4, 1, at(exifIfd)),
      entry(0x8825, 4, 1, at(gpsIfd)),
    ]),
    dateBytes,
    ifd([
      entry(0x9003, 2, dateBytes.length, at(date2)),
      entry(0x9011, 2, offsetBytes.length, at(offsetTime)),
    ]),
    dateBytes,
    offsetBytes,
    ifd([
      entry(1, 2, 2, "N\u0000"),
      entry(2, 5, 3, at(coordinates)),
      entry(3, 2, 2, "E\u0000"),
      entry(4, 5, 3, at(coordinates + 24)),
    ]),
    Buffer.concat([
      rational(readings.lat[0], 1),
      rational(readings.lat[1], 1),
      rational(readings.lat[2], 100),
      rational(readings.lng[0], 1),
      rational(readings.lng[1], 1),
      rational(readings.lng[2], 100),
    ]),
  ]);
};

const writeMovie = (name: string, body: Buffer, padding = 0): string => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "movie-exif-"));
  const file = path.join(directory, name);
  fs.writeFileSync(
    file,
    Buffer.concat([
      atom("ftyp", Buffer.from("qt  ", "latin1")),
      atom(
        "moov",
        Buffer.concat([
          atom("udta", body),
          ...(padding > 0 ? [atom("free", Buffer.alloc(padding))] : []),
        ]),
      ),
    ]),
  );
  return file;
};

const TOKYO: Readings = { date: "2025:12:01 20:15:51", lat: [35, 39, 3662], lng: [139, 43, 4523] };

describe("readMovieExif", () => {
  it("reads the wall clock, zone and coordinates a Fuji clip records", () => {
    const exif = readMovieExif(FIXTURE);

    expect(exif?.dateTimeOriginal).toBe("2026-02-27T19:51:33");
    expect(exif?.offsetTimeOriginal).toBe("+09:00");
    expect(exif?.latDeg).toBeCloseTo(36.8407753, 6);
    expect(exif?.lngDeg).toBeCloseTo(140.7917567, 6);
  });

  // The same block holds the camera and the exposure, under the keys a
  // photograph's EXIF uses, so a clip can be described and counted like one.
  it("reads the camera, lens and exposure a Fuji clip records", () => {
    expect(readMovieExif(FIXTURE)?.camera).toEqual({
      Make: "FUJIFILM",
      Model: "X-T5",
      ExposureTime: 1 / 30,
      FNumber: 1.4,
      ISO: 4000,
      ExposureCompensation: -2,
      LensInfo: [23, 23, 1.4, 1.4],
      // A prime's lens range is one focal length, so that is the focal length;
      // a zoom's would not be.
      FocalLength: 23,
    });
  });

  // The X-T5 writes a genuine UTC instant into creation_time (~35s after the
  // first frame) and the camera-local wall clock into EXIF, so reading the
  // former as local placed every clip hours from where it was taken.
  it("does not report the QuickTime instant the clip also carries", () => {
    expect(readMovieExif(FIXTURE)?.dateTimeOriginal).not.toContain("T10:52:10");
  });

  it("finds the tag atom past a large padding atom", () => {
    const exif = readMovieExif(
      writeMovie("padded.MOV", atom("MVTG", tagPayload(TOKYO, 16)), 512 * 1024),
    );

    expect(exif?.dateTimeOriginal).toBe("2025-12-01T20:15:51");
    expect(exif?.offsetTimeOriginal).toBe("+09:00");
    expect(exif?.latDeg).toBeCloseTo(35.6601, 3);
    expect(exif?.lngDeg).toBeCloseTo(139.7292, 3);
  });

  it("reads a payload that opens with a TIFF header instead", () => {
    const file = writeMovie("tiff.MOV", atom("MVTG", tagPayload(TOKYO, 8)));

    expect(readMovieExif(file)?.dateTimeOriginal).toBe("2025-12-01T20:15:51");
    expect(readMovieExif(file)?.latDeg).toBeCloseTo(35.6601, 3);
  });

  // An atom whose size does not fit 32 bits says so with a size of 1 and an
  // 8-byte size after its type. That second read landed over the type, so a
  // container written this way was never recognised and the clip read as
  // having no EXIF.
  it("descends into a container written with an extended size", () => {
    const body = atom("udta", atom("MVTG", tagPayload(TOKYO, 16)));
    const header = Buffer.alloc(16);
    header.writeUInt32BE(1, 0);
    header.write("moov", 4, "latin1");
    header.writeBigUInt64BE(BigInt(body.length + 16), 8);
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "movie-exif-"));
    const file = path.join(directory, "extended.MOV");
    fs.writeFileSync(
      file,
      Buffer.concat([atom("ftyp", Buffer.from("qt  ", "latin1")), header, body]),
    );

    expect(readMovieExif(file)?.dateTimeOriginal).toBe("2025-12-01T20:15:51");
  });

  // A GPS block the camera wrote before it had a fix holds zeroes, which read
  // as a place in the Gulf of Guinea: a clip on the map where nobody has been.
  it("reports no coordinates for a GPS block without a fix", () => {
    const noFix: Readings = { ...TOKYO, lat: [0, 0, 0], lng: [0, 0, 0] };
    const exif = readMovieExif(writeMovie("nofix.MOV", atom("MVTG", tagPayload(noFix, 16))));

    expect(exif?.dateTimeOriginal).toBe("2025-12-01T20:15:51");
    expect(exif?.latDeg).toBeUndefined();
    expect(exif?.lngDeg).toBeUndefined();
  });

  it("returns null rather than throwing on anything it cannot read", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "movie-exif-"));
    const notAMovie = path.join(directory, "notes.txt");
    fs.writeFileSync(notAMovie, "not a movie at all");
    const movieWithoutTags = writeMovie("bare.MOV", Buffer.from("nothing here", "latin1"));

    expect(readMovieExif(notAMovie)).toBeNull();
    expect(readMovieExif(path.join(directory, "absent.MOV"))).toBeNull();
    expect(readMovieExif(directory)).toBeNull();
    expect(readMovieExif(movieWithoutTags)).toBeNull();
  });

  it("gives up on a tag atom whose IFD count cannot fit the file", () => {
    // Fuji's 16-byte header, then an IFD claiming 65,535 entries.
    const corrupt = Buffer.concat([Buffer.alloc(16), Buffer.from([0xff, 0xff])]);

    expect(readMovieExif(writeMovie("corrupt.MOV", atom("MVTG", corrupt)))).toBeNull();
  });

  it("stops at a truncated tag atom instead of reading past the file", () => {
    const payload = tagPayload(TOKYO, 16);
    const file = writeMovie(
      "truncated.MOV",
      atom("MVTG", payload.subarray(0, payload.length - 40)),
    );

    const exif = readMovieExif(file);

    // The date survived; the coordinates were cut off.
    expect(exif?.dateTimeOriginal).toBe("2025-12-01T20:15:51");
    expect(exif?.latDeg).toBeUndefined();
    expect(exif?.lngDeg).toBeUndefined();
  });
});
