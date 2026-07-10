import { Database } from "@sqlite.org/sqlite-wasm";
import { SearchResultRow } from "./searchTypes";
import { RGB, deltaE, rgbToLab, parseColorPalette } from "../../util/colorDistance";
import { SearchFacetSelection } from "../../util/searchFacets";
import { SimilarityOrder } from "./searchUtils";
import {
  APERTURE_FACET,
  CAMERA_FACET,
  CITY_FACET,
  FOCAL_LENGTH_35MM_FACET,
  FOCAL_LENGTH_ACTUAL_FACET,
  HOUR_FACET,
  ISO_FACET,
  LENS_FACET,
  LOCATION_FACET,
  REGION_FACET,
  SUBREGION_FACET,
  YEAR_FACET,
} from "../../util/photoBuckets";
import type { Exif } from "../../services/types";
import {
  getGeocodeCity,
  getGeocodeCountry,
  getGeocodeRegion,
  getGeocodeSubregion,
} from "../../util/geocode";

export type PaginatedSearchResult = {
  data: SearchResultRow[];
  next?: number;
  prev?: number;
  query?: string;
};

type SearchDatabase = Database;

const isMissingEmbeddingsTableError = (err: unknown): boolean => {
  return err instanceof Error && err.message.toLowerCase().includes("no such table: embeddings");
};

type EmbeddingVector = number[] | Float32Array;

type EmbeddingRow = {
  path: string;
  model_id: string;
  embedding_dim: number;
  embedding: EmbeddingVector;
};

type RankedVectorResult = {
  path: string;
  similarity: number;
};

type RankedKeywordResult = {
  path: string;
  bm25: number;
};

type RankedHybridResult = {
  path: string;
  similarity?: number;
  bm25?: number;
  rrfScore: number;
};

type RankedColorResult = {
  path: string;
  score: number;
  rawDist: number;
  matchingColor: [number, number, number];
};

const DEFAULT_EMBEDDING_MODEL_ID = "google/siglip-base-patch16-224";
// v2 gives higher-quality image-to-image similarity; prefer it when the DB holds
// both spaces so seed lookups and ranking use a deterministic embedding space.
const PREFERRED_EMBEDDING_MODEL_ID = "google/siglip2-base-patch16-224";
const RECIPROCAL_RANK_FUSION_K = 60;

const IMAGE_COLUMNS = [
  "path",
  "album_relative_path",
  "filename",
  "geocode",
  "exif",
  "tags",
  "colors",
  "alt_text",
  "subject",
] as const;

const IMAGE_COLUMN_SELECTS = IMAGE_COLUMNS.map((column) => `images.${column}`);

const EXIF_DATE_SQL = `CASE
  WHEN instr(images.exif, 'DateTimeOriginal:') > 0 THEN replace(
    substr(
      trim(
        substr(
          images.exif,
          instr(images.exif, 'DateTimeOriginal:') + length('DateTimeOriginal:')
        )
      ),
      1,
      10
    ),
    ':',
    '-'
  )
  ELSE ''
END`;

const NORMALIZED_IMAGE_DATE_SQL = `COALESCE(
  NULLIF(substr(NULLIF(m.iso8601, ''), 1, 10), ''),
  ${EXIF_DATE_SQL}
)`;

const buildExifFieldSql = (fieldName: string): string => {
  const start = `instr(images.exif, '${fieldName}:') + length('${fieldName}:')`;
  const tail = `substr(images.exif, ${start})`;
  const newlineIndex = `instr(${tail}, char(10))`;
  return `CASE
    WHEN instr(images.exif, '${fieldName}:') > 0 THEN trim(
      substr(
        ${tail},
        1,
        CASE
          WHEN ${newlineIndex} > 0 THEN ${newlineIndex} - 1
          ELSE length(${tail})
        END
      )
    )
    ELSE ''
  END`;
};

const FACET_FIELD_SQL_BY_ID: Record<string, string> = {
  [FOCAL_LENGTH_35MM_FACET.id]: buildExifFieldSql("EXIF FocalLengthIn35mmFilm"),
  [FOCAL_LENGTH_ACTUAL_FACET.id]: buildExifFieldSql("EXIF FocalLength"),
  [APERTURE_FACET.id]: buildExifFieldSql("EXIF FNumber"),
  [ISO_FACET.id]: buildExifFieldSql("EXIF ISOSpeedRatings"),
};

const EXIF_DATETIME_SQL = buildExifFieldSql("EXIF DateTimeOriginal");
const EXIF_OFFSET_SQL = buildExifFieldSql("EXIF OffsetTime");
// DateTimeOriginal is camera-local wall time, so the local hour is read straight
// from the string ("YYYY:MM:DD HH:MM:SS" → substr positions 12-13). No offset
// arithmetic. Mirrors the JS HOUR_FACET: the hour is only returned when BOTH
// DateTimeOriginal and OffsetTime are present (older bodies without OffsetTime
// store unreliable times), otherwise NULL — so undated photos are excluded
// rather than matching the 00:00 bucket.
const LOCAL_HOUR_SQL = `CASE
  WHEN NULLIF(${EXIF_OFFSET_SQL}, '') IS NULL OR NULLIF(${EXIF_DATETIME_SQL}, '') IS NULL THEN NULL
  ELSE CAST(substr(${EXIF_DATETIME_SQL}, 12, 2) AS INTEGER)
END`;

const SEARCHABLE_NUMERIC_FACETS = [
  FOCAL_LENGTH_35MM_FACET,
  FOCAL_LENGTH_ACTUAL_FACET,
  APERTURE_FACET,
  ISO_FACET,
  HOUR_FACET,
] as const;

const SEARCHABLE_STRING_FACETS = [
  CAMERA_FACET,
  LENS_FACET,
  YEAR_FACET,
  LOCATION_FACET,
  REGION_FACET,
  SUBREGION_FACET,
  CITY_FACET,
] as const;

export type SearchFacetSectionData = {
  facetId: string;
  displayName: string;
  options: Array<{ value: string; count: number }>;
};

// Legacy fallback for DBs built before the structured geocode columns existed:
// matches the value on any line of the newline-joined blob, so city "Tokyo"
// also matches region "Tokyo". Superseded by buildGeocodeColumnClause below.
const buildGeocodeLineClause = (value: string) => ({
  sql: `(images.geocode LIKE ? OR images.geocode LIKE ?)`,
  bind: [`%\n${value}\n%`, `%\n${value}`],
});

// Precise geocode facets query the dedicated metadata columns, so a place only
// matches at the right admin level.
const GEOCODE_FACET_COLUMN: Record<string, string> = {
  [LOCATION_FACET.id]: "geo_country",
  [REGION_FACET.id]: "geo_region",
  [SUBREGION_FACET.id]: "geo_subregion",
  [CITY_FACET.id]: "geo_city",
};

const buildGeocodeColumnClause = (column: string, value: string) => ({
  // column is an internal allow-listed name from GEOCODE_FACET_COLUMN, never
  // user input; value is bound.
  sql: `images.path IN (SELECT path FROM metadata WHERE ${column} = ?)`,
  bind: [value],
});

// Cache the one-time schema probe per DB handle — old DBs lack the geo_* columns.
// Also serves as the "built by the fixed indexer" signal (the geo_* columns and
// the corrected tag counts ship together), so consumers can tell whether a DB's
// tag counts need the legacy off-by-one compensation.
const structuredGeocodeCache = new WeakMap<object, boolean>();
export const hasStructuredGeocode = (db: Database): boolean => {
  const cached = structuredGeocodeCache.get(db);
  if (cached !== undefined) {
    return cached;
  }
  let has = false;
  try {
    db.exec({
      sql: "SELECT 1 FROM pragma_table_info('metadata') WHERE name = 'geo_city' LIMIT 1",
      returnValue: "resultRows",
      callback: () => {
        has = true;
      },
    });
  } catch {
    has = false;
  }
  structuredGeocodeCache.set(db, has);
  return has;
};

const parseDbExifString = (raw: string): Exif => {
  if (!raw) {
    return {};
  }

  const values = Object.fromEntries(
    raw.split("\n").flatMap((line) => {
      const [key, ...rest] = line.split(":");
      const value = rest.join(":").trim();
      return key ? [[key.trim(), value]] : [];
    }),
  ) as Record<string, string>;

  const parseNumber = (value: string | undefined): number | undefined => {
    if (!value) {
      return undefined;
    }
    const numeric = Number.parseFloat(value);
    return Number.isFinite(numeric) ? numeric : undefined;
  };

  return {
    Make: values["Image Make"],
    Model: values["Image Model"],
    LensMake: values["EXIF LensMake"],
    LensModel: values["EXIF LensModel"],
    LensInfo: values["EXIF LensSpecification"],
    FocalLength: parseNumber(values["EXIF FocalLength"]),
    FocalLengthIn35mmFormat: parseNumber(values["EXIF FocalLengthIn35mmFilm"]),
    FNumber: parseNumber(values["EXIF FNumber"]),
    ExposureTime: parseNumber(values["EXIF ExposureTime"]),
    ISO: parseNumber(values["EXIF ISOSpeedRatings"]),
    DateTimeOriginal: values["EXIF DateTimeOriginal"],
    OffsetTime: values["EXIF OffsetTime"],
  };
};

const buildSingleFacetClause = (
  selection: SearchFacetSelection,
  hasGeocodeColumns: boolean,
): { sql: string; bind: (string | number)[] } | null => {
  if (selection.facetId === HOUR_FACET.id) {
    const bucket = HOUR_FACET.buckets.find((candidate) => candidate.label === selection.value);
    const [min, max] = bucket?.range ?? [];
    if (min == null || max == null) {
      return null;
    }

    return {
      sql: `${LOCAL_HOUR_SQL} >= ? AND ${LOCAL_HOUR_SQL} <= ?`,
      bind: [min, max],
    };
  }

  const numericFacet = SEARCHABLE_NUMERIC_FACETS.find((facet) => facet.id === selection.facetId);
  if (numericFacet) {
    const bucket = numericFacet.buckets.find((candidate) => candidate.label === selection.value);
    const fieldSql = FACET_FIELD_SQL_BY_ID[selection.facetId];
    if (!bucket?.range || !fieldSql) {
      return null;
    }

    const numericSql = `CAST(NULLIF(${fieldSql}, '') AS REAL)`;
    const [min, max] = bucket.range;
    if (min == null && max == null) {
      return null;
    }
    if (min == null) {
      return { sql: `${numericSql} <= ?`, bind: [max as number] };
    }
    if (max == null) {
      return { sql: `${numericSql} >= ?`, bind: [min] };
    }
    return { sql: `${numericSql} >= ? AND ${numericSql} <= ?`, bind: [min, max] };
  }

  const geocodeColumn = GEOCODE_FACET_COLUMN[selection.facetId];
  if (geocodeColumn) {
    return hasGeocodeColumns
      ? buildGeocodeColumnClause(geocodeColumn, selection.value)
      : buildGeocodeLineClause(selection.value);
  }

  if (selection.facetId === YEAR_FACET.id) {
    return {
      sql: `substr(${NORMALIZED_IMAGE_DATE_SQL}, 1, 4) = ?`,
      bind: [selection.value],
    };
  }

  if (selection.facetId === LENS_FACET.id) {
    return {
      sql: `images.exif LIKE ?`,
      bind: [`%EXIF LensModel:${selection.value}%`],
    };
  }

  if (selection.facetId === CAMERA_FACET.id) {
    const parts = selection.value.split(" ").filter(Boolean);
    const make = parts[0] ?? selection.value;
    const model = parts.slice(1).join(" ");
    const bind: (string | number)[] = [
      `%Image Model:${selection.value}%`,
      `%Image Make:${selection.value}%`,
    ];
    const clauses = ["images.exif LIKE ?", "images.exif LIKE ?"];
    if (model) {
      clauses.push("(images.exif LIKE ? AND images.exif LIKE ?)");
      bind.push(`%Image Make:${make}%`, `%Image Model:${model}%`);
    }
    return { sql: `(${clauses.join(" OR ")})`, bind };
  }

  const stringFacet = SEARCHABLE_STRING_FACETS.find((facet) => facet.id === selection.facetId);
  if (stringFacet) {
    return { sql: `images.exif LIKE ?`, bind: [`%${selection.value}%`] };
  }

  return null;
};

const buildFacetWhereClause = (
  selectedFacets: SearchFacetSelection[],
  hasGeocodeColumns: boolean,
) => {
  if (selectedFacets.length === 0) {
    return { sql: "", bind: [] as (string | number)[] };
  }

  const grouped = new Map<string, SearchFacetSelection[]>();
  selectedFacets.forEach((selection) => {
    const current = grouped.get(selection.facetId) ?? [];
    current.push(selection);
    grouped.set(selection.facetId, current);
  });

  const bind: (string | number)[] = [];
  const groups = Array.from(grouped.values())
    .map((group) => {
      const resolved = group
        .map((selection) => buildSingleFacetClause(selection, hasGeocodeColumns))
        .filter((value): value is { sql: string; bind: (string | number)[] } => Boolean(value));
      if (resolved.length === 0) {
        return null;
      }
      resolved.forEach((value) => {
        bind.push(...value.bind);
      });
      return `(${resolved.map((value) => `(${value.sql})`).join(" OR ")})`;
    })
    .filter(Boolean);

  return {
    sql: groups.length > 0 ? groups.join(" AND ") : "",
    bind,
  };
};

const buildKeywordWhereClause = (activeTerms: string[]) => {
  const normalizedActiveTerms = Array.from(
    new Set(activeTerms.map((term) => term.trim().toLowerCase()).filter(Boolean)),
  );

  return {
    sql: normalizedActiveTerms.map(() => "images MATCH ?").join(" AND "),
    bind: normalizedActiveTerms.map((term) => toFtsMatchTerm(term)),
  };
};

// Constrain keyword matching to the human-meaningful content columns. The raw
// `exif` blob is excluded so a query like "cat" no longer matches inside
// "LensSpecification" (and the FTS snippet — used as image alt text — no longer
// surfaces raw EXIF fragments). `colors` is excluded too so numeric queries
// ("108", "747") stop matching serialised RGB tuples and the snippet stops
// emitting tuple fragments. `path`/`album_relative_path` are file paths, not
// content. `geocode` is intentionally left searchable — place names live there.
const toFtsMatchTerm = (term: string): string => {
  return `- {path album_relative_path exif colors} : "${term.replaceAll(/["]/g, "'")}"`;
};

const exec = async (
  db: Database,
  sql: string,
  bind: (string | number)[],
  options?: {
    page?: number;
    pageSize?: number;
    query?: string;
    suppressMissingEmbeddingsTableError?: boolean;
  },
): Promise<PaginatedSearchResult> => {
  const accumulator: any[] = [];

  try {
    db.exec({
      sql,
      bind,
      returnValue: "resultRows",
      callback: (msg: any) => {
        accumulator.push(msg);
      },
    });
  } catch (err) {
    if (!(options?.suppressMissingEmbeddingsTableError && isMissingEmbeddingsTableError(err))) {
      console.error(`Bad query ${options?.query} ${options?.page}`, err);
    }
    throw err;
  }

  const prev =
    typeof options?.page !== "number" || options.page <= 0 ? undefined : options.page - 1;
  // Use a typeof check so page 0 (falsy) still advertises a next page when the
  // result set fills the page. Offset paging can't know if it's the exact-final
  // page, so a following page of 0 rows resolves `next` to undefined then.
  const next =
    typeof options?.page === "number" && accumulator.length === options.pageSize
      ? options.page + 1
      : undefined;

  return {
    data: accumulator as SearchResultRow[],
    next,
    prev,
    query: options?.query,
  };
};

const decodeInt8Embedding = (blob: Uint8Array, scale: number): Float32Array => {
  const bytes = new Int8Array(blob.buffer, blob.byteOffset, blob.byteLength);
  const vector = new Float32Array(bytes.length);
  for (let idx = 0; idx < bytes.length; idx += 1) {
    vector[idx] = bytes[idx] * scale;
  }
  return vector;
};

export const searchInternals = {
  exec,
  buildFacetWhereClause,
  hasStructuredGeocode,
  decodeInt8Embedding,
};

const mapImageRows = (rows: any[][]): SearchResultRow[] => {
  return rows.map((row) => {
    const obj: Record<string, any> = {};
    IMAGE_COLUMNS.forEach((col, idx) => {
      obj[col] = row[idx];
    });
    if (row.length > IMAGE_COLUMNS.length) {
      obj.snippet = row[IMAGE_COLUMNS.length];
    }
    if (row.length > IMAGE_COLUMNS.length + 1) {
      obj.bm25 = row[IMAGE_COLUMNS.length + 1];
    }
    return obj as SearchResultRow;
  });
};

const cosineSimilarity = (left: ArrayLike<number>, right: ArrayLike<number>): number => {
  if (left.length === 0 || left.length !== right.length) {
    return 0;
  }

  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;

  for (let idx = 0; idx < left.length; idx += 1) {
    dot += left[idx] * right[idx];
    leftNorm += left[idx] * left[idx];
    rightNorm += right[idx] * right[idx];
  }

  if (leftNorm === 0 || rightNorm === 0) {
    return 0;
  }

  return dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm));
};

const getResultSnippet = (row: SearchResultRow): string => {
  return row.snippet || row.alt_text || row.subject || row.tags;
};

const rankEmbeddingsByVector = async (opts: {
  database: SearchDatabase;
  queryVector: EmbeddingVector;
  modelId: string;
  excludePaths?: string[];
}): Promise<RankedVectorResult[]> => {
  const { database, queryVector, modelId, excludePaths = [] } = opts;
  const excluded = new Set(excludePaths);
  // All embeddings must be loaded — cosine similarity requires an exhaustive
  // scan against every vector. There is no index structure that avoids this.
  // excludePaths is a small set (typically just the query image itself).
  const candidates = await fetchEmbeddingsByModel(database, modelId);

  return candidates
    .filter((candidate) => !excluded.has(candidate.path))
    .map((candidate) => ({
      path: candidate.path,
      similarity: cosineSimilarity(queryVector, candidate.embedding),
    }))
    .sort((left, right) => right.similarity - left.similarity);
};

const fetchKeywordRanking = async (opts: {
  database: Database;
  query: string;
}): Promise<RankedKeywordResult[]> => {
  const { database, query } = opts;
  const queries = query
    .split("|")
    .map((term) => term.trim())
    .filter(Boolean);

  if (queries.length === 0) {
    return [];
  }

  const result = await exec(
    database,
    `SELECT path, bm25(images) AS bm25
      FROM images
      WHERE ${Array.from({ length: queries.length }, () => "images MATCH ?").join(" AND ")}
      ORDER BY rank`,
    queries.map((term) => toFtsMatchTerm(term)),
    { query },
  );

  return (result.data as unknown as any[][]).map((row) => ({
    path: String(row[0]),
    bm25: Number(row[1]),
  }));
};

const fuseRankingsWithRrf = (rankings: {
  keywordResults: RankedKeywordResult[];
  vectorResults: RankedVectorResult[];
}): RankedHybridResult[] => {
  const { keywordResults, vectorResults } = rankings;
  const fused = new Map<string, RankedHybridResult>();

  keywordResults.forEach((result, index) => {
    const current = fused.get(result.path) ?? {
      path: result.path,
      rrfScore: 0,
    };
    current.bm25 = result.bm25;
    current.rrfScore += 1 / (RECIPROCAL_RANK_FUSION_K + index + 1);
    fused.set(result.path, current);
  });

  vectorResults.forEach((result, index) => {
    const current = fused.get(result.path) ?? {
      path: result.path,
      rrfScore: 0,
    };
    current.similarity = result.similarity;
    current.rrfScore += 1 / (RECIPROCAL_RANK_FUSION_K + index + 1);
    fused.set(result.path, current);
  });

  return Array.from(fused.values()).sort((left, right) => {
    if (right.rrfScore !== left.rrfScore) {
      return right.rrfScore - left.rrfScore;
    }

    return (right.similarity ?? 0) - (left.similarity ?? 0);
  });
};

const fetchResultsByPaths = async (
  database: Database,
  paths: string[],
): Promise<SearchResultRow[]> => {
  if (paths.length === 0) {
    return [];
  }

  const placeholders = paths.map(() => "?").join(", ");
  const result = await exec(
    database,
    `SELECT ${IMAGE_COLUMNS.join(", ")}
      FROM images
      WHERE path IN (${placeholders})`,
    paths,
  );

  const resolved = mapImageRows(result.data as unknown as any[][]);
  const byPath = new Map(resolved.map((row) => [row.path, row]));
  return paths
    .map((candidatePath) => byPath.get(candidatePath))
    .filter((row): row is SearchResultRow => Boolean(row));
};

const fetchFacetMatchedPaths = async (
  database: Database,
  selectedFacets: SearchFacetSelection[],
): Promise<Set<string>> => {
  const facetWhere = buildFacetWhereClause(selectedFacets, hasStructuredGeocode(database));
  if (!facetWhere.sql) {
    return new Set();
  }

  const result = await exec(
    database,
    `SELECT images.path
      FROM images
      LEFT JOIN metadata m ON m.path = images.path
      WHERE ${facetWhere.sql}`,
    facetWhere.bind,
  );

  return new Set((result.data as unknown as any[][]).map((row) => String(row[0])));
};

const fetchColorMatchedResults = async (opts: {
  database: Database;
  color: RGB;
  maxDistance?: number;
  selectedFacets?: SearchFacetSelection[];
}): Promise<RankedColorResult[]> => {
  const { database, color, maxDistance = 100, selectedFacets = [] } = opts;
  const facetWhere = buildFacetWhereClause(selectedFacets, hasStructuredGeocode(database));
  const lightRows = await exec(
    database,
    `SELECT images.path, images.colors FROM images
      LEFT JOIN metadata m ON m.path = images.path
      WHERE images.colors IS NOT NULL AND images.colors != ''
      ${facetWhere.sql ? `AND ${facetWhere.sql}` : ""}`,
    facetWhere.bind,
  );

  const queryLab = rgbToLab(...color);
  const ranked: RankedColorResult[] = [];

  for (const row of lightRows.data as unknown as [string, string][]) {
    const palette = parseColorPalette(row[1]);
    if (palette.length === 0) continue;

    let bestScore = Infinity;
    let bestRawDist = Infinity;
    let closestRawDist = Infinity;
    let matchingColor: [number, number, number] = palette[0] as [number, number, number];

    for (let i = 0; i < palette.length; i++) {
      const rgb = palette[i] as [number, number, number];
      const rawDist = deltaE(queryLab, rgbToLab(...rgb));
      if (rawDist < closestRawDist) {
        closestRawDist = rawDist;
      }
      const score = rawDist * (1 + i * 0.1);
      if (score < bestScore) {
        bestScore = score;
        bestRawDist = rawDist;
        matchingColor = rgb;
      }
    }

    // Apply the tolerance against the *closest* palette entry, not the
    // prominence-weighted winner: a photo containing the query colour at a
    // less-dominant position must still qualify. Prominence weighting still
    // drives ranking via `score`.
    if (bestScore === Infinity || closestRawDist > maxDistance) continue;
    ranked.push({ path: row[0], score: bestScore, rawDist: bestRawDist, matchingColor });
  }

  ranked.sort((a, b) => a.score - b.score);
  return ranked;
};

export const fetchSearchFacetSections = async (opts: {
  database: Database;
  activeTerms?: string[];
  selectedFacets?: SearchFacetSelection[];
}): Promise<SearchFacetSectionData[]> => {
  const { database, activeTerms = [], selectedFacets = [] } = opts;
  const keywordWhere = buildKeywordWhereClause(activeTerms);
  // Geocode facet values come from the same dedicated columns the filter
  // matches, so counts and results stay in lockstep and region/subregion carry
  // their true admin level. Old DBs lack the columns → parse the blob instead.
  const useGeoColumns = hasStructuredGeocode(database);

  const fetchFacetItems = async (facetId: string) => {
    const facetWhere = buildFacetWhereClause(
      selectedFacets.filter((selection) => selection.facetId !== facetId),
      useGeoColumns,
    );
    const whereClause = [keywordWhere.sql, facetWhere.sql].filter(Boolean);
    const geoSelect = useGeoColumns
      ? ", m.geo_city, m.geo_region, m.geo_subregion, m.geo_country"
      : "";
    const result = await exec(
      database,
      `SELECT images.exif, images.geocode, ${NORMALIZED_IMAGE_DATE_SQL}${geoSelect}
        FROM images
        LEFT JOIN metadata m ON m.path = images.path
        ${whereClause.length > 0 ? `WHERE ${whereClause.join(" AND ")}` : ""}`,
      [...keywordWhere.bind, ...facetWhere.bind],
    );

    const rows = result.data as unknown as string[][];
    return rows.map((row) => ({
      exif: parseDbExifString(row[0]),
      geocode: row[1],
      normalizedDate: row[2],
      geoCity: useGeoColumns ? (row[3] ?? null) : null,
      geoRegion: useGeoColumns ? (row[4] ?? null) : null,
      geoSubregion: useGeoColumns ? (row[5] ?? null) : null,
      geoCountry: useGeoColumns ? (row[6] ?? null) : null,
    }));
  };

  const numericSections = await Promise.all(
    SEARCHABLE_NUMERIC_FACETS.map(async (facet) => {
      const items = await fetchFacetItems(facet.id);
      const counts = new Map(facet.buckets.map((bucket) => [bucket.label, 0]));

      items.forEach((item) => {
        const value = facet.extract(item.exif) ?? null;
        if (value == null) {
          return;
        }

        const bucket = facet.buckets.find((candidate) => candidate.match(value));
        if (!bucket) {
          return;
        }

        counts.set(bucket.label, (counts.get(bucket.label) ?? 0) + 1);
      });

      return {
        facetId: facet.id,
        displayName: facet.displayName,
        options: facet.buckets
          .map((bucket) => ({
            value: bucket.label,
            count: counts.get(bucket.label) ?? 0,
          }))
          .filter((option) => option.count > 0),
      };
    }),
  );

  const stringSections = await Promise.all(
    SEARCHABLE_STRING_FACETS.map(async (facet) => {
      const items = await fetchFacetItems(facet.id);
      const counts = new Map<string, number>();

      items.forEach((item) => {
        const value =
          facet.id === YEAR_FACET.id
            ? (item.normalizedDate?.slice(0, 4) ?? null)
            : facet.id === LOCATION_FACET.id
              ? ((useGeoColumns ? item.geoCountry : getGeocodeCountry(item.geocode)) ?? null)
              : facet.id === REGION_FACET.id
                ? ((useGeoColumns ? item.geoRegion : getGeocodeRegion(item.geocode)) ?? null)
                : facet.id === SUBREGION_FACET.id
                  ? ((useGeoColumns ? item.geoSubregion : getGeocodeSubregion(item.geocode)) ??
                    null)
                  : facet.id === CITY_FACET.id
                    ? ((useGeoColumns ? item.geoCity : getGeocodeCity(item.geocode)) ?? null)
                    : (facet.extract(item.exif) ?? null);
        if (!value) {
          return;
        }

        counts.set(value, (counts.get(value) ?? 0) + 1);
      });

      return {
        facetId: facet.id,
        displayName: facet.displayName,
        options: Array.from(counts.entries())
          .map(([value, count]) => ({ value, count }))
          .sort((left, right) => {
            if (facet.id === YEAR_FACET.id) {
              return Number(right.value) - Number(left.value);
            }

            if (right.count !== left.count) {
              return right.count - left.count;
            }
            return left.value.localeCompare(right.value);
          })
          .slice(0, facet.id === YEAR_FACET.id ? 20 : 12),
      };
    }),
  );

  return [...numericSections, ...stringSections].filter((section) => section.options.length > 0);
};

// The embeddings table exists in two on-disk formats: int8 blobs with a
// per-vector scale (current) and JSON text (DBs published before the format
// change, which can outlive a deploy in caches). Detect per query — the table
// can also appear mid-session when the lazily-downloaded embeddings DB swaps
// in over the core DB.
const embeddingsTableHasBlobColumn = async (database: SearchDatabase): Promise<boolean> => {
  const result = await exec(database, "PRAGMA table_info(embeddings)", []);
  return (result.data as unknown as any[][]).some((row) => String(row[1]) === "embedding_blob");
};

const decodeEmbeddingRow = (row: any[], hasBlobColumn: boolean): EmbeddingRow | null => {
  if (hasBlobColumn) {
    return {
      path: row[0],
      model_id: row[1],
      embedding_dim: row[2],
      embedding: decodeInt8Embedding(row[3] as Uint8Array, Number(row[4])),
    };
  }
  try {
    const parsed = JSON.parse(row[3]) as number[];
    if (!Array.isArray(parsed)) {
      return null;
    }
    return {
      path: row[0],
      model_id: row[1],
      embedding_dim: row[2],
      embedding: parsed,
    };
  } catch {
    console.warn(`Skipping malformed embedding for ${row[0]}`);
    return null;
  }
};

const embeddingColumnsSql = (hasBlobColumn: boolean): string =>
  hasBlobColumn
    ? "path, model_id, embedding_dim, embedding_blob, embedding_scale"
    : "path, model_id, embedding_dim, embedding_json";

const fetchEmbeddingByPath = async (
  database: SearchDatabase,
  path: string,
): Promise<EmbeddingRow | null> => {
  const hasBlobColumn = await embeddingsTableHasBlobColumn(database);
  // Deterministically prefer the v2 space (then v1) so the seed's embedding
  // space — and hence result ordering and "% match" scale — doesn't depend on
  // physical row order when the DB holds both models.
  const result = await exec(
    database,
    `SELECT ${embeddingColumnsSql(hasBlobColumn)}
      FROM embeddings
      WHERE path = ?
      ORDER BY CASE model_id
        WHEN ? THEN 0
        WHEN ? THEN 1
        ELSE 2
      END
      LIMIT 1`,
    [path, PREFERRED_EMBEDDING_MODEL_ID, DEFAULT_EMBEDDING_MODEL_ID],
    { suppressMissingEmbeddingsTableError: true },
  );

  if (result.data.length === 0) {
    return null;
  }

  return decodeEmbeddingRow(result.data[0] as unknown as any[], hasBlobColumn);
};

const fetchEmbeddingsByModel = async (
  database: SearchDatabase,
  modelId: string,
): Promise<EmbeddingRow[]> => {
  const hasBlobColumn = await embeddingsTableHasBlobColumn(database);
  const result = await exec(
    database,
    `SELECT ${embeddingColumnsSql(hasBlobColumn)}
      FROM embeddings
      WHERE model_id = ?`,
    [modelId],
    { suppressMissingEmbeddingsTableError: true },
  );

  return (result.data as unknown as any[][]).flatMap((row) => {
    const decoded = decodeEmbeddingRow(row, hasBlobColumn);
    return decoded ? [decoded] : [];
  });
};

export const fetchResults = async (opts: {
  database: Database;
  query: string;
  pageSize: number;
  page: number;
  selectedFacets?: SearchFacetSelection[];
  colorSearch?: RGB | null;
  colorTolerance?: number;
}): Promise<PaginatedSearchResult> => {
  const {
    database,
    query,
    pageSize,
    page,
    selectedFacets = [],
    colorSearch = null,
    colorTolerance = 100,
  } = opts;
  // Trim, lowercase and dedupe terms the same way buildKeywordWhereClause does,
  // so a query like "cat, night" doesn't build the FTS phrase " night" (missing
  // field-initial matches) and grid results agree with the facet counts.
  const queries = query
    ? Array.from(
        new Set(
          query
            .split("|")
            .map((term) => term.trim().toLowerCase())
            .filter(Boolean),
        ),
      )
    : [];
  const colorMatchedPaths = colorSearch
    ? (
        await fetchColorMatchedResults({
          database,
          color: colorSearch,
          maxDistance: colorTolerance,
          selectedFacets,
        })
      ).slice(0, 900)
    : null;
  const allowedPaths = colorMatchedPaths
    ? new Set(colorMatchedPaths.map((candidate) => candidate.path))
    : null;
  const colorMap = colorMatchedPaths
    ? new Map(colorMatchedPaths.map((candidate) => [candidate.path, candidate]))
    : null;
  const facetWhere = colorSearch
    ? { sql: "", bind: [] as (string | number)[] }
    : buildFacetWhereClause(selectedFacets, hasStructuredGeocode(database));
  const whereParts = [
    ...Array.from({ length: queries.length }, () => "images MATCH ?"),
    ...(facetWhere.sql ? [facetWhere.sql] : []),
    ...(allowedPaths && allowedPaths.size > 0
      ? [`images.path IN (${Array.from({ length: allowedPaths.size }, () => "?").join(", ")})`]
      : allowedPaths
        ? ["1 = 0"]
        : []),
  ];

  try {
    const result = await exec(
      database,
      queries.length > 0
        ? `SELECT ${IMAGE_COLUMN_SELECTS.join(", ")}, snippet(images, -1, '<i class="snippet">', '</i>', '…', 24) AS snippet, bm25(images) AS bm25
            FROM images
            LEFT JOIN metadata m ON m.path = images.path
            ${whereParts.length > 0 ? `WHERE ${whereParts.join(" AND ")}` : ""}
            ORDER BY rank
            LIMIT ?
            OFFSET ?`
        : `SELECT ${IMAGE_COLUMN_SELECTS.join(", ")}
            FROM images
            LEFT JOIN metadata m ON m.path = images.path
            ${whereParts.length > 0 ? `WHERE ${whereParts.join(" AND ")}` : ""}
            ORDER BY ${NORMALIZED_IMAGE_DATE_SQL} DESC, images.path DESC
            LIMIT ?
            OFFSET ?`,
      [
        ...queries.map((q) => toFtsMatchTerm(q)),
        ...facetWhere.bind,
        ...(allowedPaths ? Array.from(allowedPaths) : []),
        pageSize,
        page * pageSize,
      ],
      {
        page,
        pageSize,
        query,
      },
    );

    result.data = mapImageRows(result.data as unknown as any[][]).map((row) => {
      const colorData = colorMap?.get(row.path);
      return {
        ...row,
        matchingColor: colorData?.matchingColor,
        // Colour match goes in its own 0–100 field so the tile can distinguish
        // it from a 0–1 semantic cosine score.
        colorMatchScore: colorData
          ? Math.max(0, Math.min(100, 100 - colorData.rawDist))
          : undefined,
      };
    });
    return result;
  } catch (err) {
    console.error(`Bad query ${query} ${page}`, err);
    throw err;
  }
};

export const fetchRefinementTagCounts = async (opts: {
  database: Database;
  activeTerms: string[];
  candidateTags: string[];
  selectedFacets?: SearchFacetSelection[];
}): Promise<Record<string, number>> => {
  const { database, activeTerms, candidateTags, selectedFacets = [] } = opts;
  const normalizedActiveTerms = Array.from(
    new Set(activeTerms.map((term) => term.trim().toLowerCase()).filter(Boolean)),
  );
  const normalizedCandidateTags = Array.from(
    new Set(candidateTags.map((tag) => tag.trim().toLowerCase()).filter(Boolean)),
  ).filter((tag) => !normalizedActiveTerms.includes(tag));
  const facetWhere = buildFacetWhereClause(selectedFacets, hasStructuredGeocode(database));

  if (normalizedCandidateTags.length === 0) {
    return {};
  }

  if (normalizedActiveTerms.length === 0 && !facetWhere.sql) {
    return {};
  }

  const counts: Record<string, number> = {};
  const batchSize = 24;

  for (let idx = 0; idx < normalizedCandidateTags.length; idx += batchSize) {
    const batch = normalizedCandidateTags.slice(idx, idx + batchSize);
    const whereClause = [
      ...Array.from({ length: normalizedActiveTerms.length + 1 }, () => "images MATCH ?"),
      ...(facetWhere.sql ? [facetWhere.sql] : []),
    ].join(" AND ");
    const sql = batch
      .map(
        () =>
          `SELECT ? AS tag, COUNT(*) AS count
            FROM images
            LEFT JOIN metadata m ON m.path = images.path
            WHERE ${whereClause}`,
      )
      .join(" UNION ALL ");

    const bind: Array<string | number> = [];
    for (const tag of batch) {
      bind.push(tag);
      for (const term of [...normalizedActiveTerms, tag]) {
        bind.push(toFtsMatchTerm(term));
      }
      bind.push(...facetWhere.bind);
    }

    const result = await exec(database, sql, bind);
    for (const [tag, count] of result.data as unknown as Array<[string, number]>) {
      counts[String(tag)] = Number(count);
    }
  }

  return counts;
};

export const fetchSimilarResults = async (opts: {
  database: Database;
  embeddingsDatabase?: Database | null;
  path: string;
  similarityOrder?: SimilarityOrder;
  pageSize: number;
  page: number;
  offset?: number;
}): Promise<PaginatedSearchResult> => {
  const {
    database,
    embeddingsDatabase,
    path,
    similarityOrder = "most",
    page,
    pageSize,
    offset,
  } = opts;
  const vectorDatabase = embeddingsDatabase ?? database;

  try {
    const queryEmbedding = await fetchEmbeddingByPath(vectorDatabase, path);
    if (!queryEmbedding) {
      return { data: [], query: path, prev: undefined, next: undefined };
    }

    const rankedPaths = await rankEmbeddingsByVector({
      database: vectorDatabase,
      queryVector: queryEmbedding.embedding,
      modelId: queryEmbedding.model_id,
      excludePaths: [path],
    });
    if (similarityOrder === "least") {
      rankedPaths.reverse();
    }

    const start = typeof offset === "number" ? offset : page * pageSize;
    const end = start + pageSize;
    const pageSlice = rankedPaths.slice(start, end);
    const details = await fetchResultsByPaths(
      database,
      pageSlice.map((candidate) => candidate.path),
    );
    const detailMap = new Map(details.map((row) => [row.path, row]));

    const resolvedRows: SearchResultRow[] = [];
    for (const candidate of pageSlice) {
      const row = detailMap.get(candidate.path);
      if (!row) {
        continue;
      }
      resolvedRows.push({
        ...row,
        snippet: getResultSnippet(row),
        similarity: candidate.similarity,
      });
    }

    return {
      data: resolvedRows,
      prev:
        typeof offset === "number"
          ? start <= 0
            ? undefined
            : Math.max(0, start - pageSize)
          : page <= 0
            ? undefined
            : page - 1,
      next: rankedPaths.length > end ? (typeof offset === "number" ? end : page + 1) : undefined,
      query: path,
    };
  } catch (err) {
    if (isMissingEmbeddingsTableError(err)) {
      return { data: [], query: path, prev: undefined, next: undefined };
    }

    console.error(`Failed to fetch similar results for ${path}`, err);
    throw err;
  }
};

export const fetchColorSimilarResults = async (opts: {
  database: Database;
  color: RGB;
  pageSize: number;
  page: number;
  maxDistance?: number;
  selectedFacets?: SearchFacetSelection[];
}): Promise<PaginatedSearchResult> => {
  const { database, color, page, pageSize, maxDistance = 100, selectedFacets = [] } = opts;
  try {
    const ranked = await fetchColorMatchedResults({
      database,
      color,
      maxDistance,
      selectedFacets,
    });

    const start = page * pageSize;
    const end = start + pageSize;
    const pageSlice = ranked.slice(start, end);
    const details = await fetchResultsByPaths(
      database,
      pageSlice.map((candidate) => candidate.path),
    );
    const detailMap = new Map(details.map((row) => [row.path, row]));

    const resolvedRows: SearchResultRow[] = [];
    for (const candidate of pageSlice) {
      const row = detailMap.get(candidate.path);
      if (!row) continue;
      resolvedRows.push({
        ...row,
        snippet: getResultSnippet(row),
        colorMatchScore: Math.max(0, Math.min(100, 100 - candidate.rawDist)),
        matchingColor: candidate.matchingColor,
      });
    }

    return {
      data: resolvedRows,
      prev: page <= 0 ? undefined : page - 1,
      next: ranked.length > end ? page + 1 : undefined,
      query: `${color[0]},${color[1]},${color[2]}`,
    };
  } catch (err) {
    console.error(`Failed to fetch color similar results for ${color}`, err);
    throw err;
  }
};

export const fetchSemanticResults = async (opts: {
  database: Database;
  embeddingsDatabase?: Database | null;
  textQuery: string;
  textVector: number[];
  pageSize: number;
  page: number;
  modelId?: string;
  selectedFacets?: SearchFacetSelection[];
  colorSearch?: RGB | null;
  colorTolerance?: number;
}): Promise<PaginatedSearchResult> => {
  const {
    database,
    embeddingsDatabase,
    textQuery,
    textVector,
    page,
    pageSize,
    modelId = DEFAULT_EMBEDDING_MODEL_ID,
    selectedFacets = [],
    colorSearch = null,
    colorTolerance = 100,
  } = opts;
  const vectorDatabase = embeddingsDatabase ?? database;

  try {
    const [facetAllowedPaths, colorMatches] = await Promise.all([
      selectedFacets.length > 0 && !colorSearch
        ? fetchFacetMatchedPaths(database, selectedFacets)
        : Promise.resolve<Set<string> | null>(null),
      colorSearch
        ? fetchColorMatchedResults({
            database,
            color: colorSearch,
            maxDistance: colorTolerance,
            selectedFacets,
          })
        : Promise.resolve<RankedColorResult[] | null>(null),
    ]);
    const colorAllowedPaths = colorMatches
      ? new Set(colorMatches.map((candidate) => candidate.path))
      : null;
    const colorMap = colorMatches
      ? new Map(colorMatches.map((candidate) => [candidate.path, candidate]))
      : null;
    const allowedPaths =
      facetAllowedPaths && colorAllowedPaths
        ? new Set(Array.from(facetAllowedPaths).filter((path) => colorAllowedPaths.has(path)))
        : (facetAllowedPaths ?? colorAllowedPaths);
    const rankedPaths = await rankEmbeddingsByVector({
      database: vectorDatabase,
      queryVector: textVector,
      modelId,
    });
    const filteredRankedPaths = allowedPaths
      ? rankedPaths.filter((candidate) => allowedPaths.has(candidate.path))
      : rankedPaths;
    const pageSlice = filteredRankedPaths.slice(page * pageSize, (page + 1) * pageSize);
    const details = await fetchResultsByPaths(
      database,
      pageSlice.map((candidate) => candidate.path),
    );
    const detailMap = new Map(details.map((row) => [row.path, row]));

    const resolvedRows: SearchResultRow[] = [];
    for (const candidate of pageSlice) {
      const row = detailMap.get(candidate.path);
      if (!row) {
        continue;
      }

      resolvedRows.push({
        ...row,
        snippet: getResultSnippet(row),
        similarity: candidate.similarity,
        matchingColor: colorMap?.get(candidate.path)?.matchingColor,
      });
    }

    return {
      data: resolvedRows,
      prev: page <= 0 ? undefined : page - 1,
      next: filteredRankedPaths.length > (page + 1) * pageSize ? page + 1 : undefined,
      query: textQuery,
    };
  } catch (err) {
    if (isMissingEmbeddingsTableError(err)) {
      return { data: [], query: textQuery, prev: undefined, next: undefined };
    }

    console.error(`Failed to fetch semantic results for ${textQuery}`, err);
    throw err;
  }
};

export const fetchHybridResults = async (opts: {
  database: Database;
  embeddingsDatabase?: Database | null;
  textQuery: string;
  textVector: number[];
  pageSize: number;
  page: number;
  modelId?: string;
  keywordQuery?: string;
  selectedFacets?: SearchFacetSelection[];
  colorSearch?: RGB | null;
  colorTolerance?: number;
}): Promise<PaginatedSearchResult> => {
  const {
    database,
    embeddingsDatabase,
    textQuery,
    textVector,
    page,
    pageSize,
    modelId = DEFAULT_EMBEDDING_MODEL_ID,
    keywordQuery = textQuery,
    selectedFacets = [],
    colorSearch = null,
    colorTolerance = 100,
  } = opts;
  const vectorDatabase = embeddingsDatabase ?? database;

  try {
    const [facetAllowedPaths, colorMatches] = await Promise.all([
      selectedFacets.length > 0 && !colorSearch
        ? fetchFacetMatchedPaths(database, selectedFacets)
        : Promise.resolve<Set<string> | null>(null),
      colorSearch
        ? fetchColorMatchedResults({
            database,
            color: colorSearch,
            maxDistance: colorTolerance,
            selectedFacets,
          })
        : Promise.resolve<RankedColorResult[] | null>(null),
    ]);
    const colorAllowedPaths = colorMatches
      ? new Set(colorMatches.map((candidate) => candidate.path))
      : null;
    const colorMap = colorMatches
      ? new Map(colorMatches.map((candidate) => [candidate.path, candidate]))
      : null;
    const allowedPaths =
      facetAllowedPaths && colorAllowedPaths
        ? new Set(Array.from(facetAllowedPaths).filter((path) => colorAllowedPaths.has(path)))
        : (facetAllowedPaths ?? colorAllowedPaths);
    const [keywordResults, vectorResults] = await Promise.all([
      fetchKeywordRanking({ database, query: keywordQuery }),
      rankEmbeddingsByVector({
        database: vectorDatabase,
        queryVector: textVector,
        modelId,
      }).catch((err) => {
        // While the embeddings DB is still downloading (or genuinely
        // absent), the vector table is missing. Degrade to keyword-only ranking
        // instead of discarding the already-computed keyword results (HIGH-8).
        if (isMissingEmbeddingsTableError(err)) {
          return [] as RankedVectorResult[];
        }
        throw err;
      }),
    ]);
    const fusedResults = fuseRankingsWithRrf({
      keywordResults,
      vectorResults,
    });
    const filteredResults = allowedPaths
      ? fusedResults.filter((candidate) => allowedPaths.has(candidate.path))
      : fusedResults;
    const pageSlice = filteredResults.slice(page * pageSize, (page + 1) * pageSize);
    const details = await fetchResultsByPaths(
      database,
      pageSlice.map((candidate) => candidate.path),
    );
    const detailMap = new Map(details.map((row) => [row.path, row]));

    const resolvedRows: SearchResultRow[] = [];
    for (const candidate of pageSlice) {
      const row = detailMap.get(candidate.path);
      if (!row) {
        continue;
      }

      resolvedRows.push({
        ...row,
        snippet: getResultSnippet(row),
        bm25: candidate.bm25,
        similarity: candidate.similarity,
        rrfScore: candidate.rrfScore,
        matchingColor: colorMap?.get(candidate.path)?.matchingColor,
      });
    }

    return {
      data: resolvedRows,
      prev: page <= 0 ? undefined : page - 1,
      next: filteredResults.length > (page + 1) * pageSize ? page + 1 : undefined,
      query: textQuery,
    };
  } catch (err) {
    if (isMissingEmbeddingsTableError(err)) {
      return { data: [], query: textQuery, prev: undefined, next: undefined };
    }

    console.error(`Failed to fetch hybrid results for ${textQuery}`, err);
    throw err;
  }
};

export const fetchTags = async (opts: {
  database: Database;
  pageSize: number;
  page: number;
  minCount?: number;
}): Promise<{ data: { tag: string; count: number }[] }> => {
  const { database, pageSize, page, minCount } = opts;

  try {
    const result = (await exec(
      database,
      `SELECT *
        FROM tags
        WHERE count >= ?
        ORDER BY count DESC
        LIMIT ?
        OFFSET ?`,
      [minCount ?? 0, pageSize, page * pageSize],
    )) as unknown as { data: any[] };
    result.data = result.data.map((row) => {
      return { tag: row[0], count: row[1] };
    });
    return result;
  } catch (err) {
    console.error(`Failed to fetch tags, page: ${page} size: ${pageSize}`, err);
    throw err;
  }
};

export const fetchRecentResults = async (opts: {
  database: Database;
  pageSize: number;
}): Promise<SearchResultRow[]> => {
  const { database, pageSize } = opts;

  try {
    const recentResults = await exec(
      database,
      `SELECT ${IMAGE_COLUMN_SELECTS.join(", ")}
        FROM images
        LEFT JOIN metadata m ON m.path = images.path
        WHERE ${NORMALIZED_IMAGE_DATE_SQL} != ''
        ORDER BY ${NORMALIZED_IMAGE_DATE_SQL} DESC
        LIMIT ?`,
      [pageSize],
    );

    const rows = mapImageRows(recentResults.data as unknown as any[][]);

    return rows.map((row) => ({
      ...row,
      snippet: row.alt_text || row.subject || row.tags || row.filename,
    }));
  } catch (err) {
    console.error(`Failed to fetch recent results`, err);
    throw err;
  }
};

export const fetchMemoryCandidates = async (opts: {
  database: Database;
  todayDate: string;
}): Promise<Array<SearchResultRow & { isoDate: string }>> => {
  const { database, todayDate } = opts;
  const excludeYear = todayDate.slice(0, 4);

  try {
    const result = await exec(
      database,
      `SELECT ${IMAGE_COLUMN_SELECTS.join(", ")}, ${NORMALIZED_IMAGE_DATE_SQL} AS isoDate
        FROM images
        LEFT JOIN metadata m ON m.path = images.path
        WHERE ${NORMALIZED_IMAGE_DATE_SQL} != ''
          AND substr(${NORMALIZED_IMAGE_DATE_SQL}, 1, 4) != ?
        ORDER BY isoDate DESC`,
      [excludeYear],
    );

    return (result.data as unknown as any[][]).map((row) => {
      const imageValues = row.slice(0, IMAGE_COLUMNS.length);
      const resolved: Record<string, any> = {};
      IMAGE_COLUMNS.forEach((column, index) => {
        resolved[column] = imageValues[index];
      });

      const isoDate = String(row[IMAGE_COLUMNS.length] ?? "");
      return {
        ...(resolved as SearchResultRow),
        isoDate,
        snippet: resolved.alt_text || resolved.subject || resolved.tags || resolved.filename,
      };
    });
  } catch (err) {
    console.error("Failed to fetch memory candidates", err);
    throw err;
  }
};

export const fetchRandomResults = async (opts: {
  database: Database;
  pageSize: number;
  excludePaths?: string[];
}): Promise<SearchResultRow[]> => {
  const { database, pageSize, excludePaths = [] } = opts;

  try {
    const placeholders = excludePaths.map(() => "?").join(", ");
    const whereClause = excludePaths.length > 0 ? `WHERE path NOT IN (${placeholders})` : "";
    const randomResults = await exec(
      database,
      `SELECT ${IMAGE_COLUMN_SELECTS.join(", ")}
        FROM images
        ${whereClause}
        ORDER BY RANDOM()
        LIMIT ?`,
      [...excludePaths, pageSize],
    );

    const rows = mapImageRows(randomResults.data as unknown as any[][]);

    return rows.map((row) => ({
      ...row,
      snippet: row.alt_text || row.subject || row.tags || row.filename,
    }));
  } catch (err) {
    console.error(`Failed to fetch random results`, err);
    throw err;
  }
};

export type RandomPhotoRow = {
  path: string;
  exif: string;
  geocode: string;
  colors?: string;
};

export const fetchSlideshowPhotos = async (opts: {
  database: Database;
  filter?: string;
}): Promise<RandomPhotoRow[]> => {
  const { database, filter = "%" } = opts;

  try {
    const result = await exec(
      database,
      `SELECT path, exif, geocode, colors
      FROM images
      WHERE path LIKE ?`,
      [`../albums/${filter}/%`],
    );

    return (result.data as unknown as string[][]).map((row) => ({
      path: row[0],
      exif: row[1],
      geocode: row[2],
      colors: row[3],
    }));
  } catch (err) {
    console.error(`Failed to fetch slideshow photos`, err);
    throw err;
  }
};

export const fetchRandomPhoto = async (opts: {
  database: Database;
  filter?: string;
}): Promise<RandomPhotoRow[]> => {
  const { database, filter = "%" } = opts;

  try {
    const result = await exec(
      database,
      `SELECT path, exif, geocode
      FROM images
      WHERE path LIKE ?
      ORDER BY RANDOM()
      LIMIT 1`,
      [`../albums/${filter}/%`],
    );
    const row = result.data[0] as unknown as string[] | undefined;
    if (!row) {
      return [];
    }
    return [
      {
        path: row[0],
        exif: row[1],
        geocode: row[2],
      },
    ];
  } catch (err) {
    console.error(`Failed to fetch random photo`, err);
    throw err;
  }
};

export type GuessRegionOption = { country: string; count: number };

/** Fetches distinct countries with GPS-tagged photo counts, sorted by count. */
export const fetchGuessRegions = async (opts: {
  database: Database;
}): Promise<GuessRegionOption[]> => {
  try {
    const result = await exec(
      opts.database,
      `SELECT geocode FROM images WHERE exif LIKE '%GPSLatitude%'`,
      [],
    );
    const counts = new Map<string, number>();
    for (const row of result.data as unknown as string[][]) {
      const country = getGeocodeCountry(row[0]);
      if (!country) continue;
      counts.set(country, (counts.get(country) ?? 0) + 1);
    }
    return Array.from(counts.entries())
      .filter(([, count]) => count >= 3)
      .map(([country, count]) => ({ country, count }))
      .sort((a, b) => b.count - a.count);
  } catch (err) {
    console.error("Failed to fetch guess regions", err);
    return [];
  }
};

export const fetchGuessPhotos = async (opts: {
  database: Database;
  count: number;
  filter?: string;
  region?: string;
  seed?: string;
}): Promise<RandomPhotoRow[]> => {
  const { database, count, filter = "%", region, seed } = opts;

  const baseWhere = `path LIKE ? AND exif LIKE '%GPSLatitude%'`;
  const regionClause = region
    ? ` AND (geocode LIKE '%\n' || ? OR geocode LIKE '%\n' || ? || '\n%')`
    : "";
  const baseParams: (string | number)[] = [`../albums/${filter}/%`];
  if (region) {
    baseParams.push(region, region);
  }

  try {
    if (!seed) {
      const result = await exec(
        database,
        `SELECT path, exif, geocode FROM images
         WHERE ${baseWhere}${regionClause}
         ORDER BY RANDOM() LIMIT ?`,
        [...baseParams, count],
      );
      return (result.data as unknown as string[][]).map((row) => ({
        path: row[0],
        exif: row[1],
        geocode: row[2],
      }));
    }

    // Seeded: fetch all matching paths, shuffle deterministically, then
    // fetch full rows for the selected subset.
    const allResult = await exec(
      database,
      `SELECT path FROM images WHERE ${baseWhere}${regionClause}`,
      baseParams,
    );
    const allPaths = (allResult.data as unknown as string[][]).map((r) => r[0]);
    const selected = seededShuffle(allPaths, seed).slice(0, count);

    if (selected.length === 0) return [];

    const placeholders = selected.map(() => "?").join(",");
    const result = await exec(
      database,
      `SELECT path, exif, geocode FROM images WHERE path IN (${placeholders})`,
      selected,
    );
    const rowMap = new Map(
      (result.data as unknown as string[][]).map((row) => [
        row[0],
        { path: row[0], exif: row[1], geocode: row[2] },
      ]),
    );
    return selected.flatMap((p) => {
      const row = rowMap.get(p);
      return row ? [row] : [];
    });
  } catch (err) {
    console.error(`Failed to fetch guess photos`, err);
    throw err;
  }
};

/** Simple seeded PRNG (mulberry32). */
const mulberry32 = (seed: number) => {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

/** Hash a string to a 32-bit integer for use as a PRNG seed. */
const hashSeed = (str: string): number => {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (Math.imul(31, hash) + str.charCodeAt(i)) | 0;
  }
  return hash;
};

/** Fisher-Yates shuffle with a seeded PRNG. Returns a new array. */
export const seededShuffle = <T>(arr: T[], seed: string): T[] => {
  const result = [...arr];
  const rng = mulberry32(hashSeed(seed));
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
};
