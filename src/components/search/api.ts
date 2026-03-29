import { Database, Sqlite3Static } from "@sqlite.org/sqlite-wasm";
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
  ISO_FACET,
  LENS_FACET,
  LOCATION_FACET,
  REGION_FACET,
  SUBREGION_FACET,
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
  return (
    err instanceof Error &&
    err.message.toLowerCase().includes("no such table: embeddings")
  );
};

type EmbeddingRow = {
  path: string;
  model_id: string;
  embedding_dim: number;
  embedding_json: string;
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

const DEFAULT_EMBEDDING_MODEL_ID = "google/siglip-base-patch16-224";
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

const SEARCHABLE_NUMERIC_FACETS = [
  FOCAL_LENGTH_35MM_FACET,
  FOCAL_LENGTH_ACTUAL_FACET,
  APERTURE_FACET,
  ISO_FACET,
] as const;

const SEARCHABLE_STRING_FACETS = [
  CAMERA_FACET,
  LENS_FACET,
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

const buildGeocodeLineClause = (value: string) => ({
  sql: `(images.geocode LIKE ? OR images.geocode LIKE ?)`,
  bind: [`%\n${value}\n%`, `%\n${value}`],
});

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
): { sql: string; bind: (string | number)[] } | null => {
  const numericFacet = SEARCHABLE_NUMERIC_FACETS.find(
    (facet) => facet.id === selection.facetId,
  );
  if (numericFacet) {
    const bucket = numericFacet.buckets.find(
      (candidate) => candidate.label === selection.value,
    );
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

  if (selection.facetId === LOCATION_FACET.id) {
    return buildGeocodeLineClause(selection.value);
  }

  if (selection.facetId === REGION_FACET.id) {
    return buildGeocodeLineClause(selection.value);
  }

  if (selection.facetId === SUBREGION_FACET.id) {
    return buildGeocodeLineClause(selection.value);
  }

  if (selection.facetId === CITY_FACET.id) {
    return buildGeocodeLineClause(selection.value);
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

  const stringFacet = SEARCHABLE_STRING_FACETS.find(
    (facet) => facet.id === selection.facetId,
  );
  if (stringFacet) {
    return { sql: `images.exif LIKE ?`, bind: [`%${selection.value}%`] };
  }

  return null;
};

const buildFacetWhereClause = (selectedFacets: SearchFacetSelection[]) => {
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
        .map((selection) => buildSingleFacetClause(selection))
        .filter((value): value is { sql: string; bind: (string | number)[] } =>
          Boolean(value),
        );
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
    new Set(
      activeTerms.map((term) => term.trim().toLowerCase()).filter(Boolean),
    ),
  );

  return {
    sql: normalizedActiveTerms.map(() => "images MATCH ?").join(" AND "),
    bind: normalizedActiveTerms.map((term) => toFtsMatchTerm(term)),
  };
};

const toFtsMatchTerm = (term: string): string => {
  return `- {path album_relative_path} : "${term.replaceAll(/[\"]/g, "'")}"`;
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
    if (
      !(
        options?.suppressMissingEmbeddingsTableError &&
        isMissingEmbeddingsTableError(err)
      )
    ) {
      console.error(`Bad query ${options?.query} ${options?.page}`, err);
    }
    throw err;
  }

  const prev =
    !options?.page || options.page <= 0 ? undefined : options.page - 1;
  const next =
    options?.page && accumulator.length === options.pageSize
      ? options.page + 1
      : undefined;

  return {
    data: accumulator as SearchResultRow[],
    next,
    prev,
    query: options?.query,
  };
};

export const searchInternals = { exec };

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

const cosineSimilarity = (left: number[], right: number[]): number => {
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
  queryVector: number[];
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
    .flatMap((candidate) => {
      try {
        return [
          {
            path: candidate.path,
            similarity: cosineSimilarity(
              queryVector,
              // JSON.parse is necessary here — embeddings must be deserialized to compute cosine similarity at query time
            JSON.parse(candidate.embedding_json) as number[],
            ),
          },
        ];
      } catch {
        console.warn(`Skipping malformed embedding for ${candidate.path}`);
        return [];
      }
    })
    .sort((left, right) => right.similarity - left.similarity);
};

const fetchKeywordRanking = async (opts: {
  database: Database;
  query: string;
}): Promise<RankedKeywordResult[]> => {
  const { database, query } = opts;
  const queries = query.split("|").map((term) => term.trim()).filter(Boolean);

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
  const facetWhere = buildFacetWhereClause(selectedFacets);
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

  return new Set(
    (result.data as unknown as any[][]).map((row) => String(row[0])),
  );
};

export const fetchSearchFacetSections = async (opts: {
  database: Database;
  activeTerms?: string[];
  selectedFacets?: SearchFacetSelection[];
}): Promise<SearchFacetSectionData[]> => {
  const { database, activeTerms = [], selectedFacets = [] } = opts;
  const keywordWhere = buildKeywordWhereClause(activeTerms);

  const fetchFacetItems = async (facetId: string) => {
    const facetWhere = buildFacetWhereClause(
      selectedFacets.filter((selection) => selection.facetId !== facetId),
    );
    const whereClause = [keywordWhere.sql, facetWhere.sql].filter(Boolean);
    const result = await exec(
      database,
      `SELECT images.exif, images.geocode
        FROM images
        LEFT JOIN metadata m ON m.path = images.path
        ${whereClause.length > 0 ? `WHERE ${whereClause.join(" AND ")}` : ""}`,
      [...keywordWhere.bind, ...facetWhere.bind],
    );

    const rows = result.data as unknown as Array<[string, string]>;
    return rows.map(([exif, geocode]) => ({
      exif: parseDbExifString(exif),
      geocode,
    }));
  };

  const numericSections = await Promise.all(SEARCHABLE_NUMERIC_FACETS.map(async (facet) => {
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
  }));

  const stringSections = await Promise.all(SEARCHABLE_STRING_FACETS.map(async (facet) => {
    const items = await fetchFacetItems(facet.id);
    const counts = new Map<string, number>();

    items.forEach((item) => {
      const value =
        facet.id === LOCATION_FACET.id
          ? getGeocodeCountry(item.geocode) ?? null
          : facet.id === REGION_FACET.id
            ? getGeocodeRegion(item.geocode) ?? null
            : facet.id === SUBREGION_FACET.id
              ? getGeocodeSubregion(item.geocode) ?? null
          : facet.id === CITY_FACET.id
            ? getGeocodeCity(item.geocode) ?? null
            : facet.extract(item.exif) ?? null;
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
          if (right.count !== left.count) {
            return right.count - left.count;
          }
          return left.value.localeCompare(right.value);
        })
        .slice(0, 12),
    };
  }));

  return [...numericSections, ...stringSections].filter(
    (section) => section.options.length > 0,
  );
};

const fetchEmbeddingByPath = async (
  database: SearchDatabase,
  path: string,
): Promise<EmbeddingRow | null> => {
  const result = await exec(
    database,
    `SELECT path, model_id, embedding_dim, embedding_json
      FROM embeddings
      WHERE path = ?`,
    [path],
    { suppressMissingEmbeddingsTableError: true },
  );

  if (result.data.length === 0) {
    return null;
  }

  const row = result.data[0] as unknown as any[];
  return {
    path: row[0],
    model_id: row[1],
    embedding_dim: row[2],
    embedding_json: row[3],
  };
};

const fetchEmbeddingsByModel = async (
  database: SearchDatabase,
  modelId: string,
): Promise<EmbeddingRow[]> => {
  const result = await exec(
    database,
    `SELECT path, model_id, embedding_dim, embedding_json
      FROM embeddings
      WHERE model_id = ?`,
    [modelId],
    { suppressMissingEmbeddingsTableError: true },
  );

  return (result.data as unknown as any[][]).map((row) => ({
    path: row[0],
    model_id: row[1],
    embedding_dim: row[2],
    embedding_json: row[3],
  }));
};

export const fetchResults = async (opts: {
  database: Database;
  query: string;
  pageSize: number;
  page: number;
  selectedFacets?: SearchFacetSelection[];
}): Promise<PaginatedSearchResult> => {
  const { database, query, pageSize, page, selectedFacets = [] } = opts;
  const queries = query ? query.split("|").filter(Boolean) : [];
  const facetWhere = buildFacetWhereClause(selectedFacets);
  const whereParts = [
    ...Array.from({ length: queries.length }, () => "images MATCH ?"),
    ...(facetWhere.sql ? [facetWhere.sql] : []),
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
        pageSize,
        page * pageSize,
      ],
      {
        page,
        pageSize,
        query,
      },
    );

    result.data = mapImageRows(result.data as unknown as any[][]);
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
  const {
    database,
    activeTerms,
    candidateTags,
    selectedFacets = [],
  } = opts;
  const normalizedActiveTerms = Array.from(
    new Set(
      activeTerms.map((term) => term.trim().toLowerCase()).filter(Boolean),
    ),
  );
  const normalizedCandidateTags = Array.from(
    new Set(
      candidateTags.map((tag) => tag.trim().toLowerCase()).filter(Boolean),
    ),
  ).filter((tag) => !normalizedActiveTerms.includes(tag));
  const facetWhere = buildFacetWhereClause(selectedFacets);

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
      ...Array.from(
        { length: normalizedActiveTerms.length + 1 },
        () => "images MATCH ?",
      ),
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
    for (const [tag, count] of result.data as unknown as Array<
      [string, number]
    >) {
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

    let queryVector: number[];
    try {
      queryVector = JSON.parse(queryEmbedding.embedding_json) as number[];
    } catch {
      return { data: [], query: path, prev: undefined, next: undefined };
    }
    const rankedPaths = await rankEmbeddingsByVector({
      database: vectorDatabase,
      queryVector,
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
      next:
        rankedPaths.length > end
          ? typeof offset === "number"
            ? end
            : page + 1
          : undefined,
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
}): Promise<PaginatedSearchResult> => {
  const { database, color, page, pageSize, maxDistance = 100 } = opts;

  try {
    // All images must be loaded and scored — deltaE operates in CIELAB space where
    // perceptual distance doesn't map to RGB ranges. SQL pre-filtering by RGB would
    // silently drop valid results (a color far in RGB can be close in LAB).
    const lightRows = await exec(
      database,
      `SELECT path, colors FROM images WHERE colors IS NOT NULL AND colors != ''`,
      [],
    );

    const queryLab = rgbToLab(...color);
    const ranked: { path: string; score: number; rawDist: number; matchingColor: [number, number, number] }[] = [];

    for (const row of lightRows.data as unknown as [string, string][]) {
      const palette = parseColorPalette(row[1]);
      if (palette.length === 0) continue;

      let bestScore = Infinity;
      let bestRawDist = Infinity;
      let matchingColor: [number, number, number] = palette[0] as [number, number, number];

      for (let i = 0; i < palette.length; i++) {
        const rgb = palette[i] as [number, number, number];
        const rawDist = deltaE(queryLab, rgbToLab(...rgb));
        // Mild dominance weight: palette[0] (most dominant) has no penalty;
        // later entries get a small additive penalty so dominant-color matches rank higher.
        const score = rawDist * (1 + i * 0.1);
        if (score < bestScore) {
          bestScore = score;
          bestRawDist = rawDist;
          matchingColor = rgb;
        }
      }

      if (bestScore === Infinity || bestRawDist > maxDistance) continue;
      ranked.push({ path: row[0], score: bestScore, rawDist: bestRawDist, matchingColor });
    }

    ranked.sort((a, b) => a.score - b.score);

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
        similarity: Math.max(0, Math.min(100, 100 - candidate.rawDist)),
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
  } = opts;
  const vectorDatabase = embeddingsDatabase ?? database;

  try {
    const allowedPaths =
      selectedFacets.length > 0
        ? await fetchFacetMatchedPaths(database, selectedFacets)
        : null;
    const rankedPaths = await rankEmbeddingsByVector({
      database: vectorDatabase,
      queryVector: textVector,
      modelId,
    });
    const filteredRankedPaths = allowedPaths
      ? rankedPaths.filter((candidate) => allowedPaths.has(candidate.path))
      : rankedPaths;
    const pageSlice = filteredRankedPaths.slice(
      page * pageSize,
      (page + 1) * pageSize,
    );
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
      prev: page <= 0 ? undefined : page - 1,
      next:
        filteredRankedPaths.length > (page + 1) * pageSize
          ? page + 1
          : undefined,
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
  } = opts;
  const vectorDatabase = embeddingsDatabase ?? database;

  try {
    const allowedPaths =
      selectedFacets.length > 0
        ? await fetchFacetMatchedPaths(database, selectedFacets)
        : null;
    const [keywordResults, vectorResults] = await Promise.all([
      fetchKeywordRanking({ database, query: keywordQuery }),
      rankEmbeddingsByVector({
        database: vectorDatabase,
        queryVector: textVector,
        modelId,
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
      });
    }

    return {
      data: resolvedRows,
      prev: page <= 0 ? undefined : page - 1,
      next:
        filteredResults.length > (page + 1) * pageSize
          ? page + 1
          : undefined,
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
        snippet:
          resolved.alt_text ||
          resolved.subject ||
          resolved.tags ||
          resolved.filename,
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
    const whereClause =
      excludePaths.length > 0 ? `WHERE path NOT IN (${placeholders})` : "";
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

export type RandomPhotoRow = { path: string; exif: string; geocode: string };

export const fetchSlideshowPhotos = async (opts: {
  database: Database;
  filter?: string;
}): Promise<RandomPhotoRow[]> => {
  const { database, filter = "%" } = opts;

  try {
    const result = await exec(
      database,
      `SELECT path, exif, geocode
      FROM images
      WHERE path LIKE ?`,
      [`../albums/${filter}/%`],
    );

    return (result.data as unknown as string[][]).map((row) => ({
      path: row[0],
      exif: row[1],
      geocode: row[2],
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
