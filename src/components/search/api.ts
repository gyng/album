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

export const fetchResults = async (opts: {
  query: string;
  pageSize: number;
  page: number;
}): Promise<PaginatedSearchResult> => {
  const { query, pageSize, page } = opts;

  return new Promise(async (resolve, reject) => {
    const accumulator: any[] = [];

    try {
      await window.db("exec", {
        sql: `SELECT *, snippet(images, -1, '<i class="snippet">', '</i>', '…', 24) AS snippet, bm25(images) AS bm25
        FROM images
        WHERE images MATCH ?
        ORDER BY rank
        LIMIT ?
        OFFSET ?`,
        bind: [
          `- {path album_relative_path} : "${query.replaceAll(/["]/g, "'")}"`,
          pageSize,
          page * pageSize,
        ],
        callback: async (msg: any) => {
          if (msg.row) {
            const record: Record<string, string> = {};
            (msg.columnNames as Array<string>).forEach((cn, i) => {
              record[cn] = msg.row[i];
            });
            record.type = msg.type;
            accumulator.push(record);
          } else {
            const prev = page <= 0 ? undefined : page - 1;
            // This is not strictly correct, we need to do a SQL COUNT to be sure
            const next = accumulator.length === pageSize ? page + 1 : undefined;
            resolve({ data: accumulator, next, prev, query: query });
          }
        },
      });
    } catch (err) {
      console.error(`Bad query ${query} ${page}`, err);
      reject(err);
    }
  });
};
