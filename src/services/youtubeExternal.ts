/**
 * Build-time metadata for YouTube externals.
 *
 * An external has no bytes in the album directory, so it is otherwise invisible
 * to everything downstream of the album page: no title to search, no frame to
 * embed, no date to place on the timeline. YouTube's oEmbed endpoint supplies
 * the title and a thumbnail, and the thumbnail is downloaded once and cached so
 * that nothing at request time depends on a third-party host.
 *
 * The cached outputs are named exactly like a local clip's — "<id>.youtube"
 * standing in for a filename — so posters, search index paths and page anchors
 * take one shape for both kinds of video.
 */

import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
// Type-only, and therefore erased: this module is required directly from
// bin/prepare-video-posters.cjs through Node's TypeScript stripping, which
// cannot resolve extensionless relative imports at runtime. Everything it needs
// from the poster module is injected by the caller instead (see `resolvePaths`).
import type { VideoPosterPaths } from "./videoPoster";

export const YOUTUBE_MEDIA_EXTENSION = ".youtube";
export const YOUTUBE_OEMBED_ENDPOINT = "https://www.youtube.com/oembed";
// oEmbed advertises the 480x360 still. The 1280x720 one lives at a predictable
// URL and is a far better poster, but it is not generated for every video, so it
// is attempted first and the advertised URL is the fallback.
export const youtubeMaxResThumbnailUrl = (videoId: string): string =>
  `https://i.ytimg.com/vi/${videoId}/maxresdefault.jpg`;
export const YOUTUBE_FETCH_TIMEOUT_MS = 10_000;

export type YoutubeOembed = {
  title?: string;
  author_name?: string;
  thumbnail_url?: string;
};

export type YoutubeSidecar = {
  mediaKind: "video";
  provider: "youtube";
  videoId: string;
  href: string;
  title?: string;
  authorName?: string;
  capturedAtLocal?: string;
};

// Video ids are 11 characters today; the range is kept loose enough to survive
// a future change of length while still rejecting a stray path segment.
const YOUTUBE_ID_PATTERN = /^[\w-]{8,16}$/;

export const parseYoutubeVideoId = (href: string): string | undefined => {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return undefined;
  }

  const host = url.hostname.replace(/^www\./, "");
  const candidate =
    host === "youtu.be"
      ? url.pathname.slice(1)
      : host.endsWith("youtube.com")
        ? url.pathname.startsWith("/embed/")
          ? url.pathname.slice("/embed/".length)
          : (url.searchParams.get("v") ?? "")
        : "";

  const id = candidate.split("/")[0] ?? "";
  return YOUTUBE_ID_PATTERN.test(id) ? id : undefined;
};

export const youtubeMediaFilename = (videoId: string): string =>
  `${videoId}${YOUTUBE_MEDIA_EXTENSION}`;

export const isYoutubeMediaFilename = (filename: string): boolean =>
  filename.toLowerCase().endsWith(YOUTUBE_MEDIA_EXTENSION);

/**
 * Manifest dates are written with the offset of wherever the clip was shot.
 * That offset only names the zone the wall clock is already in, so the local
 * reading is kept and the offset dropped — never applied — matching how EXIF
 * and QuickTime timestamps are stored throughout the pipeline.
 */
export const normaliseExternalDate = (raw: string | undefined): string | undefined => {
  if (!raw) {
    return undefined;
  }
  const withTime = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})/.exec(raw.trim());
  if (withTime) {
    const [, year, month, day, hour, minute, second] = withTime;
    return `${year}-${month}-${day}T${hour}:${minute}:${second}`;
  }
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw.trim());
  if (dateOnly) {
    return `${dateOnly[1]}-${dateOnly[2]}-${dateOnly[3]}T00:00:00`;
  }
  return undefined;
};

export const buildYoutubeSidecar = ({
  videoId,
  href,
  date,
  oembed,
}: {
  videoId: string;
  href: string;
  date?: string;
  oembed: YoutubeOembed;
}): YoutubeSidecar => {
  const capturedAtLocal = normaliseExternalDate(date);
  return {
    mediaKind: "video",
    provider: "youtube",
    videoId,
    href,
    ...(oembed.title ? { title: oembed.title } : {}),
    ...(oembed.author_name ? { authorName: oembed.author_name } : {}),
    ...(capturedAtLocal ? { capturedAtLocal } : {}),
  };
};

type FetchLike = typeof fetch;

const withTimeout = async <T>(
  work: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
): Promise<T> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await work(controller.signal);
  } finally {
    clearTimeout(timer);
  }
};

export const fetchYoutubeOembed = async (
  videoId: string,
  {
    fetchImpl = fetch,
    timeoutMs = YOUTUBE_FETCH_TIMEOUT_MS,
  }: { fetchImpl?: FetchLike; timeoutMs?: number } = {},
): Promise<YoutubeOembed | null> => {
  const target = `${YOUTUBE_OEMBED_ENDPOINT}?format=json&url=${encodeURIComponent(
    `https://www.youtube.com/watch?v=${videoId}`,
  )}`;

  try {
    const response = await withTimeout((signal) => fetchImpl(target, { signal }), timeoutMs);
    if (!response.ok) {
      return null;
    }
    return (await response.json()) as YoutubeOembed;
  } catch {
    // Offline, rate-limited, or a removed video: the caller falls back to
    // whatever it cached last time rather than failing the build.
    return null;
  }
};

export type YoutubeExternal = { type: "youtube"; href: string; date?: string };

export type EnsureYoutubePosterOptions = {
  albumName: string;
  publicAlbumsDir: string;
  /** posterPathsFor from ./videoPoster, injected to keep this module import-free. */
  resolvePaths: (mediaPath: string, publicAlbumsDir: string) => VideoPosterPaths;
  sizes: number[];
  avif: Record<string, unknown>;
  fetchImpl?: FetchLike;
  timeoutMs?: number;
  force?: boolean;
};

export type EnsureYoutubePosterResult = {
  paths: VideoPosterPaths;
  sidecar: YoutubeSidecar;
  extracted: boolean;
  variantsEncoded: number;
};

const readSidecar = (sidecarPath: string): YoutubeSidecar | null => {
  try {
    return JSON.parse(fs.readFileSync(sidecarPath, "utf-8")) as YoutubeSidecar;
  } catch {
    return null;
  }
};

const isDecodableFile = async (target: string): Promise<boolean> => {
  try {
    if (fs.statSync(target).size === 0) {
      return false;
    }
    const metadata = await sharp(target).metadata();
    return Boolean(metadata.width && metadata.height);
  } catch {
    return false;
  }
};

const downloadThumbnail = async (
  url: string,
  target: string,
  {
    fetchImpl = fetch,
    timeoutMs = YOUTUBE_FETCH_TIMEOUT_MS,
  }: { fetchImpl?: FetchLike; timeoutMs?: number },
): Promise<void> => {
  const response = await withTimeout((signal) => fetchImpl(url, { signal }), timeoutMs);
  if (!response.ok) {
    throw new Error(`Could not download the thumbnail for ${url} (${response.status})`);
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  // YouTube serves JPEG, but normalise through sharp so the file the indexer
  // reads is a known-decodable image rather than whatever arrived.
  await sharp(bytes).jpeg({ quality: 90 }).toFile(target);
};

/**
 * Ensure an external has a cached poster frame and sidecar. Network work only
 * happens when the cache is cold, so repeat builds — and offline builds after a
 * first successful one — do not touch YouTube at all.
 */
export const ensureYoutubePoster = async (
  external: YoutubeExternal,
  options: EnsureYoutubePosterOptions,
): Promise<EnsureYoutubePosterResult> => {
  const videoId = parseYoutubeVideoId(external.href);
  if (!videoId) {
    throw new Error(`Could not read a YouTube video id from ${external.href}`);
  }

  // posterPathsFor keys everything off the album directory of the given path,
  // so hand it the synthetic album-relative path an external would have.
  const syntheticPath = path.join(options.albumName, youtubeMediaFilename(videoId));
  const paths = options.resolvePaths(syntheticPath, options.publicAlbumsDir);

  const cachedSidecar = readSidecar(paths.sidecar);
  const posterUsable =
    !options.force && cachedSidecar !== null && (await isDecodableFile(paths.posterSource));

  let sidecar = cachedSidecar;
  let extracted = false;

  if (!posterUsable) {
    const oembed =
      (await fetchYoutubeOembed(videoId, {
        ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
        ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
      })) ?? {};

    if (!oembed.thumbnail_url) {
      throw new Error(`No thumbnail is available for ${external.href}`);
    }

    fs.mkdirSync(path.dirname(paths.posterSource), { recursive: true });
    const temp = `${paths.posterSource}.tmp-${process.pid}`;
    const download = {
      ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
      ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
    };

    try {
      await downloadThumbnail(youtubeMaxResThumbnailUrl(videoId), temp, download);
    } catch {
      await downloadThumbnail(oembed.thumbnail_url, temp, download);
    }

    if (!(await isDecodableFile(temp))) {
      fs.rmSync(temp, { force: true });
      throw new Error(`The downloaded thumbnail for ${external.href} is not a readable image`);
    }
    fs.renameSync(temp, paths.posterSource);
    extracted = true;

    sidecar = buildYoutubeSidecar({
      videoId,
      href: external.href,
      ...(external.date !== undefined ? { date: external.date } : {}),
      oembed,
    });
    fs.writeFileSync(paths.sidecar, `${JSON.stringify(sidecar, null, 2)}\n`);
  }

  fs.mkdirSync(paths.variantDirectory, { recursive: true });
  let variantsEncoded = 0;
  for (const size of options.sizes) {
    const target = paths.variantFor(size);
    if (!extracted && (await isDecodableFile(target))) {
      continue;
    }
    const temp = `${target}.tmp-${process.pid}`;
    await sharp(paths.posterSource)
      .resize({ width: size, withoutEnlargement: true })
      .avif(options.avif)
      .toFile(temp);
    fs.renameSync(temp, target);
    variantsEncoded += 1;
  }

  return {
    paths,
    sidecar: sidecar ?? buildYoutubeSidecar({ videoId, href: external.href, oembed: {} }),
    extracted,
    variantsEncoded,
  };
};
