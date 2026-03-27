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

const IMAGE_COLUMNS = [
  "path",
  "album_relative_path",
  "filename",
  "geocode",
  "exif",
  "tags",
  "colors",
  "alt_text",
  "critique",
  "suggested_title",
  "composition_critique",
  "subject",
] as const;

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
      [
        ...queries.map(
          (q) =>
            `- {path album_relative_path} : "${q.replaceAll(/["]/g, "'")}"`,
        ),
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

export const fetchSimilarResults = async (opts: {
  database: Database;
  path: string;
  pageSize: number;
  page: number;
}): Promise<PaginatedSearchResult> => {
  const { database, path, page, pageSize } = opts;

  try {
    const queryEmbedding = await fetchEmbeddingByPath(database, path);
    if (!queryEmbedding) {
      return { data: [], query: path, prev: undefined, next: undefined };
    }

    const queryVector = JSON.parse(queryEmbedding.embedding_json) as number[];
    const candidates = await fetchEmbeddingsByModel(
      database,
      queryEmbedding.model_id,
    );
    const rankedPaths = candidates
      .filter((candidate) => candidate.path !== path)
      .map((candidate) => ({
        path: candidate.path,
        similarity: cosineSimilarity(
          queryVector,
          JSON.parse(candidate.embedding_json) as number[],
        ),
      }))
      .sort((left, right) => right.similarity - left.similarity);

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
        snippet: row.snippet || row.alt_text || row.subject || row.tags,
        similarity: candidate.similarity,
      });
    }

    return {
      data: resolvedRows,
      prev: page <= 0 ? undefined : page - 1,
      next: rankedPaths.length > (page + 1) * pageSize ? page + 1 : undefined,
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

export type RandomPhotoRow = { path: string; exif: string; geocode: string };

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
