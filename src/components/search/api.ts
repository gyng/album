export type SearchResult = {
  path: string;
  album_relative_path: string;
  snippet: string;
  bm25: number;
  tags: string;
  colors: string;
};

export type PaginatedSearchResult = {
  data: SearchResult[];
  next?: number;
  prev?: number;
  query?: string;
};

const exec = (
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
      await window.db("exec", {
        sql,
        bind,
        callback: async (msg: any) => {
          if (msg.row) {
            const record: Record<string, string> = {};
            (msg.columnNames as Array<string>).forEach((cn, i) => {
              record[cn] = msg.row[i];
            });
            record.type = msg.type;
            accumulator.push(record);
          } else {
            const prev =
              !options?.page || options.page <= 0
                ? undefined
                : options.page - 1;
            // This is not strictly correct, we need to do a SQL COUNT to be sure
            const next =
              options?.page && accumulator.length === options.pageSize
                ? options.page + 1
                : undefined;
            resolve({ data: accumulator, next, prev, query: options?.query });
          }
        },
      });
    } catch (err) {
      console.error(`Bad query ${options?.query} ${options?.page}`, err);
      reject(err);
    }
  });
};

export const fetchResults = async (opts: {
  query: string;
  pageSize: number;
  page: number;
}): Promise<PaginatedSearchResult> => {
  const { query, pageSize, page } = opts;

  try {
    return await exec(
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
  } catch (err) {
    console.error(`Bad query ${query} ${page}`, err);
    throw err;
  }
};
