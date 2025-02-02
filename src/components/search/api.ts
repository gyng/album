import { Database, Sqlite3Static } from "@sqlite.org/sqlite-wasm";

export type PaginatedSearchResult = {
  data: any[];
  next?: number;
  prev?: number;
  query?: string;
};

const exec = (
  db: Database,
  sql: string,
  bind: (string | number)[],
  options?: {
    page: number;
    pageSize: number;
    query: string;
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
      console.error(`Bad query ${options?.query} ${options?.page}`, err);
      reject(err);
    }

    const prev =
      !options?.page || options.page <= 0 ? undefined : options.page - 1;
    // This is not strictly correct, we need to do a SQL COUNT to be sure
    const next =
      options?.page && accumulator.length === options.pageSize
        ? options.page + 1
        : undefined;

    resolve({ data: accumulator, next, prev, query: options?.query });
  });
};

export const fetchResults = async (opts: {
  database: Database;
  query: string;
  pageSize: number;
  page: number;
}): Promise<PaginatedSearchResult> => {
  const { database, query, pageSize, page } = opts;

  try {
    const result = await exec(
      database,
      `SELECT *, snippet(images, -1, '<i class="snippet">', '</i>', '…', 24) AS snippet, bm25(images) AS bm25
        FROM images
        WHERE images MATCH ?
        ORDER BY rank
        LIMIT ?
        OFFSET ?`,
      [
        `- {path album_relative_path} : "${query.replaceAll(/["]/g, "'")}"`,
        pageSize,
        page * pageSize,
      ],
      {
        page,
        pageSize,
        query,
      },
    );
    const columns = [
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
      "snippet",
      "bm25",
    ];

    result.data = result.data.map((row) => {
      const obj: any = {};
      columns.forEach((col, idx) => {
        obj[col] = row[idx];
      });
      return obj;
    });

    return result;
  } catch (err) {
    console.error(`Bad query ${query} ${page}`, err);
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

export const fetchRandomPhoto = async (opts: {
  database: Database;
  filter?: string;
}): Promise<{ path: string }[]> => {
  const { database, filter = "%" } = opts;

  try {
    const result = await exec(
      database,
      `SELECT path
      FROM images
      WHERE path LIKE ?
      ORDER BY RANDOM()
      LIMIT 1`,
      [`../albums/${filter}/%`],
    );
    return [{ path: result.data[0] }];
  } catch (err) {
    console.error(`Failed to fetch random photo`, err);
    throw err;
  }
};
