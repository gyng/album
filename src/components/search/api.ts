import { Database, Sqlite3Static } from "@sqlite.org/sqlite-wasm";
import { SearchResultRow } from "./searchTypes";

export type PaginatedSearchResult = {
  data: SearchResultRow[];
  next?: number;
  prev?: number;
  query?: string;
};

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

const toFtsMatchTerm = (term: string): string => {
  return `- {path album_relative_path} : "${term.replaceAll(/[\"]/g, "'")}"`;
};

const exec = (
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
  return new Promise(async (resolve, reject) => {
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
      reject(err);
      return;
    }

    const prev =
      !options?.page || options.page <= 0 ? undefined : options.page - 1;
    const next =
      options?.page && accumulator.length === options.pageSize
        ? options.page + 1
        : undefined;

    resolve({
      data: accumulator as SearchResultRow[],
      next,
      prev,
      query: options?.query,
    });
  });
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
  database: Database;
  queryVector: number[];
  modelId: string;
  excludePaths?: string[];
}): Promise<RankedVectorResult[]> => {
  const { database, queryVector, modelId, excludePaths = [] } = opts;
  const excluded = new Set(excludePaths);
  const candidates = await fetchEmbeddingsByModel(database, modelId);

  return candidates
    .filter((candidate) => !excluded.has(candidate.path))
    .map((candidate) => ({
      path: candidate.path,
      similarity: cosineSimilarity(
        queryVector,
        JSON.parse(candidate.embedding_json) as number[],
      ),
    }))
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

const fetchEmbeddingByPath = async (
  database: Database,
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
  database: Database,
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
}): Promise<PaginatedSearchResult> => {
  const { database, query, pageSize, page } = opts;
  const queries = query.split("|");

  try {
    const result = await exec(
      database,
      `SELECT *, snippet(images, -1, '<i class="snippet">', '</i>', '…', 24) AS snippet, bm25(images) AS bm25
        FROM images
        WHERE ${Array.from({ length: queries.length }, () => "images MATCH ?").join(" AND ")}
        ORDER BY rank
        LIMIT ?
        OFFSET ?`,
      [...queries.map((q) => toFtsMatchTerm(q)), pageSize, page * pageSize],
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
}): Promise<Record<string, number>> => {
  const { database, activeTerms, candidateTags } = opts;
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

  if (
    normalizedActiveTerms.length === 0 ||
    normalizedCandidateTags.length === 0
  ) {
    return {};
  }

  const counts: Record<string, number> = {};
  const batchSize = 24;

  for (let idx = 0; idx < normalizedCandidateTags.length; idx += batchSize) {
    const batch = normalizedCandidateTags.slice(idx, idx + batchSize);
    const sql = batch
      .map(
        () =>
          `SELECT ? AS tag, COUNT(*) AS count
            FROM images
            WHERE ${Array.from({ length: normalizedActiveTerms.length + 1 }, () => "images MATCH ?").join(" AND ")}`,
      )
      .join(" UNION ALL ");

    const bind: Array<string | number> = [];
    for (const tag of batch) {
      bind.push(tag);
      for (const term of [...normalizedActiveTerms, tag]) {
        bind.push(toFtsMatchTerm(term));
      }
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
  path: string;
  pageSize: number;
  page: number;
  offset?: number;
}): Promise<PaginatedSearchResult> => {
  const { database, path, page, pageSize, offset } = opts;

  try {
    const queryEmbedding = await fetchEmbeddingByPath(database, path);
    if (!queryEmbedding) {
      return { data: [], query: path, prev: undefined, next: undefined };
    }

    const queryVector = JSON.parse(queryEmbedding.embedding_json) as number[];
    const rankedPaths = await rankEmbeddingsByVector({
      database,
      queryVector,
      modelId: queryEmbedding.model_id,
      excludePaths: [path],
    });

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

export const fetchSemanticResults = async (opts: {
  database: Database;
  textQuery: string;
  textVector: number[];
  pageSize: number;
  page: number;
  modelId?: string;
}): Promise<PaginatedSearchResult> => {
  const {
    database,
    textQuery,
    textVector,
    page,
    pageSize,
    modelId = DEFAULT_EMBEDDING_MODEL_ID,
  } = opts;

  try {
    const rankedPaths = await rankEmbeddingsByVector({
      database,
      queryVector: textVector,
      modelId,
    });
    const pageSlice = rankedPaths.slice(page * pageSize, (page + 1) * pageSize);
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
      next: rankedPaths.length > (page + 1) * pageSize ? page + 1 : undefined,
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
  textQuery: string;
  textVector: number[];
  pageSize: number;
  page: number;
  modelId?: string;
  keywordQuery?: string;
}): Promise<PaginatedSearchResult> => {
  const {
    database,
    textQuery,
    textVector,
    page,
    pageSize,
    modelId = DEFAULT_EMBEDDING_MODEL_ID,
    keywordQuery = textQuery,
  } = opts;

  try {
    const [keywordResults, vectorResults] = await Promise.all([
      fetchKeywordRanking({ database, query: keywordQuery }),
      rankEmbeddingsByVector({
        database,
        queryVector: textVector,
        modelId,
      }),
    ]);
    const fusedResults = fuseRankingsWithRrf({
      keywordResults,
      vectorResults,
    });
    const pageSlice = fusedResults.slice(page * pageSize, (page + 1) * pageSize);
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
      next: fusedResults.length > (page + 1) * pageSize ? page + 1 : undefined,
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
        WHERE COALESCE(
          NULLIF(m.iso8601, ''),
          CASE
            WHEN instr(images.exif, 'DateTimeOriginal:') > 0 THEN trim(
              substr(
                images.exif,
                instr(images.exif, 'DateTimeOriginal:') + length('DateTimeOriginal:'),
                19
              )
            )
            ELSE ''
          END
        ) != ''
        ORDER BY COALESCE(
          NULLIF(m.iso8601, ''),
          CASE
            WHEN instr(images.exif, 'DateTimeOriginal:') > 0 THEN trim(
              substr(
                images.exif,
                instr(images.exif, 'DateTimeOriginal:') + length('DateTimeOriginal:'),
                19
              )
            )
            ELSE ''
          END
        ) DESC
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
    const row = result.data[0] as unknown as string[];
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
