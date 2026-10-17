/**
 * The capture metadata a Fuji clip carries in its own EXIF block.
 *
 * `ffprobe` cannot see inside a MOV's embedded EXIF, and the QuickTime tags it
 * can see are not the camera's wall clock. On an X-T5 movie the two differ:
 * `creation_time` holds a genuine UTC instant (it is stamped "Z", and the clip
 * is written ~35s after its own first frame), while the EXIF `DateTimeOriginal`
 * — the same tag every photo is dated from — holds the camera-local wall
 * clock. Reading `creation_time` as if it were already local placed every clip
 * eight or nine hours early: the Tokyo City View clip was indexed at 11:16 in
 * the morning and the "Bokeh of water at night" test at 13:43 in the afternoon.
 * The EXIF block is also the only place a Fuji clip's coordinates live, so
 * without it a video could never reach the map or the timeline.
 *
 * The block sits in the QuickTime `udta` user-data atom as Fuji's own `MVTG`
 * atom: a 16-byte header followed by a little-endian TIFF IFD whose value
 * offsets are counted from that header. Apple's clips instead publish
 * `com.apple.quicktime.location.ISO6709` and a creation date with an offset,
 * which ffprobe does expose, so this reader is a *preference* for what a movie
 * itself recorded rather than the only source.
 *
 * Nothing here may throw on a malformed or exotic file: a clip whose metadata
 * cannot be read keeps whatever the caller's fallbacks say, exactly as a photo
 * without EXIF does.
 */

import fs from "node:fs";

export type MovieExif = {
  /** Camera-local wall clock, `YYYY-MM-DDTHH:MM:SS` with no zone. */
  dateTimeOriginal?: string;
  /** The zone the camera's own wall clock was set to, when it recorded one. */
  offsetTimeOriginal?: string;
  latDeg?: number;
  lngDeg?: number;
};

const ATOM_HEADER_BYTES = 8;
const EXTENDED_SIZE_BYTES = 8;
// Only these can hold the tag atom; a leaf atom's payload is pixels or samples.
const CONTAINER_ATOMS: Record<string, true> = {
  moov: true,
  udta: true,
  trak: true,
  mdia: true,
  minf: true,
  stbl: true,
};
const MAX_CONTAINER_DEPTH = 6;
const MAX_ATOMS_VISITED = 4096;
/** Fuji's atom is ~12 KB; the cap only stops a bogus size reading the file in. */
const MAX_TAG_ATOM_BYTES = 4 * 1024 * 1024;
const TAG_ATOM = "MVTG";
/** Header of Fuji's payload, and therefore where its IFD offsets are counted from. */
const TAG_PAYLOAD_HEADER_BYTES = 16;

const IFD_ENTRY_BYTES = 12;

const tagExifIfd = 0x8769;
const tagGpsIfd = 0x8825;
const tagDateTimeOriginal = 0x9003;
const tagOffsetTimeOriginal = 0x9011;

const gpsLatitudeRef = 1;
const gpsLatitude = 2;
const gpsLongitudeRef = 3;
const gpsLongitude = 4;

const TYPE_ASCII = 2;
const TYPE_SHORT = 3;
const TYPE_LONG = 4;
const TYPE_RATIONAL = 5;

type Layout = {
  littleEndian: boolean;
  ifdOffset: number;
  /** What value offsets are counted from — the TIFF header for EXIF, Fuji's own. */
  valuesBase: number;
};

type IfdEntry = {
  tag: number;
  type: number;
  count: number;
  /** The four bytes the entry always carries: the value itself, or where it is. */
  inline: Buffer;
};

const readIfdEntries = (buffer: Buffer, ifdOffset: number, layout: Layout): IfdEntry[] | null => {
  if (ifdOffset < 0 || ifdOffset + 2 > buffer.length) {
    return null;
  }
  const count = layout.littleEndian
    ? buffer.readUInt16LE(ifdOffset)
    : buffer.readUInt16BE(ifdOffset);
  // A count this large cannot fit the file it came from, so the entry is a
  // misread rather than a huge directory.
  const available = Math.floor((buffer.length - ifdOffset - 2) / IFD_ENTRY_BYTES);
  if (count > available) {
    return null;
  }

  const entries: IfdEntry[] = [];
  for (let index = 0; index < count; index += 1) {
    const at = ifdOffset + 2 + index * IFD_ENTRY_BYTES;
    entries.push({
      tag: layout.littleEndian ? buffer.readUInt16LE(at) : buffer.readUInt16BE(at),
      type: layout.littleEndian ? buffer.readUInt16LE(at + 2) : buffer.readUInt16BE(at + 2),
      count: layout.littleEndian ? buffer.readUInt32LE(at + 4) : buffer.readUInt32BE(at + 4),
      inline: buffer.subarray(at + 8, at + 12),
    });
  }
  return entries;
};

const findEntry = (entries: IfdEntry[] | null, tag: number): IfdEntry | undefined =>
  entries?.find((entry) => entry.tag === tag);

/** Bytes for an entry: a short value travels inside the entry itself. */
const entryBytes = (buffer: Buffer, entry: IfdEntry, layout: Layout): Buffer | null => {
  const width = entry.type === TYPE_RATIONAL ? 8 : 1;
  const total = entry.count * width;
  if (total <= 4) {
    return entry.inline.subarray(0, total);
  }
  const raw = layout.littleEndian ? entry.inline.readUInt32LE(0) : entry.inline.readUInt32BE(0);
  const at = layout.valuesBase + raw;
  if (at < 0 || at + total > buffer.length) {
    return null;
  }
  return buffer.subarray(at, at + total);
};

const readAscii = (
  buffer: Buffer,
  entry: IfdEntry | undefined,
  layout: Layout,
): string | undefined => {
  if (!entry || entry.type !== TYPE_ASCII) {
    return undefined;
  }
  const bytes = entryBytes(buffer, entry, layout);
  if (!bytes) {
    return undefined;
  }
  const decoded = bytes.toString("latin1");
  const terminator = decoded.indexOf("\u0000");
  const value = (terminator === -1 ? decoded : decoded.slice(0, terminator)).trim();
  return value.length > 0 ? value : undefined;
};

const readRationals = (
  buffer: Buffer,
  entry: IfdEntry | undefined,
  layout: Layout,
  wanted: number,
): number[] | undefined => {
  if (!entry || entry.type !== TYPE_RATIONAL || entry.count < wanted) {
    return undefined;
  }
  const bytes = entryBytes(buffer, entry, layout);
  if (!bytes) {
    return undefined;
  }
  const values: number[] = [];
  for (let index = 0; index < wanted; index += 1) {
    const at = index * 8;
    const numerator = layout.littleEndian ? bytes.readUInt32LE(at) : bytes.readUInt32BE(at);
    const denominator = layout.littleEndian
      ? bytes.readUInt32LE(at + 4)
      : bytes.readUInt32BE(at + 4);
    if (denominator === 0) {
      return undefined;
    }
    values.push(numerator / denominator);
  }
  return values;
};

const readSubIfdOffset = (
  buffer: Buffer,
  entry: IfdEntry | undefined,
  layout: Layout,
): number | undefined => {
  if (!entry || entry.count !== 1) {
    return undefined;
  }
  if (entry.type !== TYPE_LONG && entry.type !== TYPE_SHORT) {
    return undefined;
  }
  const raw =
    entry.type === TYPE_LONG
      ? layout.littleEndian
        ? entry.inline.readUInt32LE(0)
        : entry.inline.readUInt32BE(0)
      : layout.littleEndian
        ? entry.inline.readUInt16LE(0)
        : entry.inline.readUInt16BE(0);
  return layout.valuesBase + raw;
};

// "2025:04:12 18:20:12" is what a camera writes; the pipeline carries naive
// ISO everywhere else.
const exifDateToNaiveIso = (raw: string | undefined): string | undefined => {
  if (!raw) {
    return undefined;
  }
  const match = /^(\d{4})[:-](\d{2})[:-](\d{2})[T ](\d{2}):(\d{2}):(\d{2})/.exec(raw);
  if (!match) {
    return undefined;
  }
  const [, year, month, day, hour, minute, second] = match;
  return `${year}-${month}-${day}T${hour}:${minute}:${second}`;
};

const sexagesimalToDegrees = (parts: number[], negative: boolean): number => {
  const [degrees = 0, minutes = 0, seconds = 0] = parts;
  const magnitude = degrees + minutes / 60 + seconds / 3600;
  return negative ? -magnitude : magnitude;
};

const parseTagPayload = (buffer: Buffer): MovieExif | null => {
  if (buffer.length < TAG_PAYLOAD_HEADER_BYTES + 2) {
    return null;
  }

  // A payload that opens with a TIFF header is a plain EXIF blob, so its values
  // are counted from byte 0; Fuji's carries its own header instead.
  const magic = buffer.toString("latin1", 0, 4);
  const isTiff = magic === "II*\u0000" || magic === "MM\u0000*";
  let littleEndian = true;
  let ifdOffset = TAG_PAYLOAD_HEADER_BYTES;
  let valuesBase = TAG_PAYLOAD_HEADER_BYTES;
  if (isTiff) {
    littleEndian = magic.startsWith("II");
    ifdOffset = littleEndian ? buffer.readUInt32LE(4) : buffer.readUInt32BE(4);
    valuesBase = 0;
  }
  const layout: Layout = { littleEndian, ifdOffset, valuesBase };

  const ifd0 = readIfdEntries(buffer, layout.ifdOffset, layout);
  if (!ifd0) {
    return null;
  }

  const exifIfdOffset = readSubIfdOffset(buffer, findEntry(ifd0, tagExifIfd), layout);
  const exifIfd =
    exifIfdOffset === undefined ? null : readIfdEntries(buffer, exifIfdOffset, layout);
  const dateTimeOriginal = exifDateToNaiveIso(
    readAscii(buffer, findEntry(exifIfd, tagDateTimeOriginal), layout),
  );
  const offsetTimeOriginal = readAscii(buffer, findEntry(exifIfd, tagOffsetTimeOriginal), layout);

  const gpsIfdOffset = readSubIfdOffset(buffer, findEntry(ifd0, tagGpsIfd), layout);
  const gpsIfd = gpsIfdOffset === undefined ? null : readIfdEntries(buffer, gpsIfdOffset, layout);
  let latDeg: number | undefined;
  let lngDeg: number | undefined;
  const latitude = readRationals(buffer, findEntry(gpsIfd, gpsLatitude), layout, 3);
  const longitude = readRationals(buffer, findEntry(gpsIfd, gpsLongitude), layout, 3);
  if (latitude && longitude) {
    const latitudeRef = readAscii(buffer, findEntry(gpsIfd, gpsLatitudeRef), layout) ?? "N";
    const longitudeRef = readAscii(buffer, findEntry(gpsIfd, gpsLongitudeRef), layout) ?? "E";
    const candidateLat = sexagesimalToDegrees(latitude, latitudeRef.toUpperCase().startsWith("S"));
    const candidateLng = sexagesimalToDegrees(
      longitude,
      longitudeRef.toUpperCase().startsWith("W"),
    );
    // A coordinate is only a place with both halves of it, in range — and not
    // the zeroes a camera writes before it has a fix.
    if (
      Number.isFinite(candidateLat) &&
      Number.isFinite(candidateLng) &&
      Math.abs(candidateLat) <= 90 &&
      Math.abs(candidateLng) <= 180 &&
      (candidateLat !== 0 || candidateLng !== 0)
    ) {
      latDeg = Number(candidateLat.toFixed(7));
      lngDeg = Number(candidateLng.toFixed(7));
    }
  }

  if (dateTimeOriginal === undefined && latDeg === undefined && offsetTimeOriginal === undefined) {
    return null;
  }

  return {
    ...(dateTimeOriginal !== undefined ? { dateTimeOriginal } : {}),
    ...(offsetTimeOriginal !== undefined ? { offsetTimeOriginal } : {}),
    ...(latDeg !== undefined ? { latDeg } : {}),
    ...(lngDeg !== undefined ? { lngDeg } : {}),
  };
};

type AtomHeader = { type: string; payloadOffset: number; payloadEnd: number };

const readAtomHeader = (handle: number, position: number, fileSize: number): AtomHeader | null => {
  if (position + ATOM_HEADER_BYTES > fileSize) {
    return null;
  }
  const header = Buffer.alloc(ATOM_HEADER_BYTES + EXTENDED_SIZE_BYTES);
  const read = fs.readSync(handle, header, 0, ATOM_HEADER_BYTES, position);
  if (read < ATOM_HEADER_BYTES) {
    return null;
  }
  let size = header.readUInt32BE(0);
  let headerBytes = ATOM_HEADER_BYTES;
  if (size === 1) {
    if (position + ATOM_HEADER_BYTES + EXTENDED_SIZE_BYTES > fileSize) {
      return null;
    }
    // After the type, so the type is still there to be read.
    if (
      fs.readSync(
        handle,
        header,
        ATOM_HEADER_BYTES,
        EXTENDED_SIZE_BYTES,
        position + ATOM_HEADER_BYTES,
      ) < EXTENDED_SIZE_BYTES
    ) {
      return null;
    }
    headerBytes += EXTENDED_SIZE_BYTES;
    const extended = header.readBigUInt64BE(ATOM_HEADER_BYTES);
    if (extended > BigInt(Number.MAX_SAFE_INTEGER)) {
      return null;
    }
    size = Number(extended);
  }
  // A size of zero means "to the end of the file"; anything smaller than its own
  // header cannot be advanced past.
  const payloadEnd = size === 0 ? fileSize : Math.min(position + size, fileSize);
  const payloadOffset = position + headerBytes;
  if (payloadEnd <= payloadOffset) {
    return null;
  }
  return { type: header.toString("latin1", 4, 8), payloadOffset, payloadEnd };
};

const findTagAtomWithin = (
  handle: number,
  start: number,
  end: number,
  depth: number,
  visited: { count: number },
): AtomHeader | null => {
  let position = start;
  while (position < end && visited.count < MAX_ATOMS_VISITED) {
    visited.count += 1;
    const atom = readAtomHeader(handle, position, end);
    if (!atom) {
      return null;
    }
    if (atom.type === TAG_ATOM) {
      return atom;
    }
    if (CONTAINER_ATOMS[atom.type] === true && depth < MAX_CONTAINER_DEPTH) {
      const inner = findTagAtomWithin(
        handle,
        atom.payloadOffset,
        atom.payloadEnd,
        depth + 1,
        visited,
      );
      if (inner) {
        return inner;
      }
    }
    position = atom.payloadEnd;
  }
  return null;
};

/**
 * The EXIF a movie file carries for itself, or null when it has none this reader
 * understands. Read-only, and bounded: only atom headers and the tag atom are
 * ever read, so a multi-gigabyte clip costs the same as a short one.
 */
export const readMovieExif = (filePath: string): MovieExif | null => {
  let handle: number;
  try {
    handle = fs.openSync(filePath, "r");
  } catch {
    return null;
  }
  try {
    const fileSize = fs.fstatSync(handle).size;
    const atom = findTagAtomWithin(handle, 0, fileSize, 0, { count: 0 });
    if (!atom) {
      return null;
    }
    const length = Math.min(atom.payloadEnd - atom.payloadOffset, MAX_TAG_ATOM_BYTES);
    const buffer = Buffer.alloc(length);
    const read = fs.readSync(handle, buffer, 0, length, atom.payloadOffset);
    if (read <= 0) {
      return null;
    }
    return parseTagPayload(read === length ? buffer : buffer.subarray(0, read));
  } catch {
    return null;
  } finally {
    fs.closeSync(handle);
  }
};
