import React, { useEffect, useRef, useState } from "react";
import { createSQLiteThread, createHttpBackend } from "sqlite-wasm-http";
import { useDebounce } from "use-debounce";
import styles from "./Search.module.css";
import Link from "next/link";
import { Backend } from "sqlite-wasm-http/dist/vfs-http-types";
import { useRouter } from "next/router";

declare global {
  interface Window {
    db: any;
  }
}

export const initBackend = () => {
  const httpBackend = createHttpBackend({
    maxPageSize: 4096, // this is the current default SQLite page size
    timeout: 10000, // 10s
    cacheSize: 4096, // 4 MB
  });
  return httpBackend;
};

export const initDb = async (backend: Backend) => {
  return createSQLiteThread({ http: backend }).then((d) => {
    if (!window.db) {
      // Using setState crashes the library
      window.db = d;
      const remoteURL = "/search.sqlite";
      window.db("open", {
        filename: remoteURL,
        vfs: "http",
      });
    } else {
      console.warn("search DB thread already set", window.db);
    }
  });
};

export const Search: React.FC<{ disabled?: boolean }> = (props) => {
  const PAGE_SIZE = 23;
  const router = useRouter();

  const [backend, setBackend] = useState<ReturnType<
    typeof createHttpBackend
  > | null>(null);
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [debouncedSearchQuery] = useDebounce(searchQuery, 600);
  const inputRef = useRef<HTMLInputElement>(null);
  const [page, setPage] = useState(0);

  const [results, setResults] = useState<
    Record<
      string,
      {
        results: any[];
        status: "done" | "searching" | "new";
      }
    >
  >({});

  useEffect(() => {
    const httpBackend = initBackend();
    setBackend(httpBackend);
  }, []);

  // Need to split initialisation out as the library doesn't guarantee that the backend worker is ready
  useEffect(() => {
    if (!backend || !backend.worker) {
      return;
    }
    initDb(backend).catch(console.error);
  }, [backend, backend?.worker]);

  const doSearch = async (query: string, _page = 0, _pageSize = 23) => {
    if (!query) {
      return;
    }

    if (!window.db) {
      console.log(`window.db not initialised, retrying "${query}"`);
      setTimeout(() => {
        window.location.reload();
      }, 2000);
      return;
    }

    if (results[query]?.status === "searching") {
      // prevent duplicate active queries
      return;
    }

    // When clicking "more", don't remove old results
    if (_page === 0) {
      setResults((cur) => ({
        ...cur,
        [query]: {
          results: [],
          status: "searching",
        },
      }));
    }

    // Potential duplicates when two queries
    // with the same same search term are in-flight
    // Eg, entering the following
    // `dog` > query (dog1) executes
    // `dogs` > query (dogs) executes
    // `dog` > backspace, query (dog2) executes
    // dog1 and dog2 are both returning results
    //
    // We store all return results until it's complete
    // and at that point we "commit" it all to `results` using `setResults`
    const resultsBuffer: Record<string, string>[] =
      results[query]?.results ?? [];
    const exec = await window.db("exec", {
      sql: `SELECT *, snippet(images, -1, '<i class="snippet">', '</i>', '…', 24) AS snippet, bm25(images) AS bm25 FROM images WHERE images MATCH ? ORDER BY rank LIMIT ? OFFSET ?`,
      bind: [
        `- {path album_relative_path} : "${query.replaceAll(/["]/g, "'")}"`,
        _pageSize,
        _page * _pageSize,
      ],
      callback: (msg: any) => {
        if (msg.row) {
          const record: Record<string, string> = {};
          (msg.columnNames as Array<string>).forEach((cn, i) => {
            record[cn] = msg.row[i];
          });
          record.type = msg.type;
          resultsBuffer.push(record);
        } else {
          setResults((cur) => {
            return {
              ...cur,
              [query]: {
                ...cur.query,
                results: resultsBuffer,
                status: "done",
              },
            };
          });
        }
      },
    });
  };

  useEffect(() => {
    setPage(0);
    doSearch(debouncedSearchQuery, 0);
  }, [debouncedSearchQuery]);

  useEffect(() => {
    doSearch(debouncedSearchQuery, page);
  }, [page]);

  const SearchResult = (props: {
    result: {
      path: string;
      album_relative_path: string;
      snippet: string;
      bm25: number;
      tags: string;
      colors: string;
    };
  }) => {
    const { result } = props;

    // [(92, 124, 161), (213, 200, 192), (9, 9, 11), (152, 187, 215)]
    let colour = "rgba(255, 255, 255, 0.2)";
    try {
      if (result.colors) {
        const colourRgb = JSON.parse(
          result.colors.replaceAll("(", "[").replaceAll(")", "]")
        )[0];
        colour = `rgba(${colourRgb[0]}, ${colourRgb[1]}, ${colourRgb[2]}, 1)`;
      }
    } catch (err) {
      // noop
    }

    // hack, assumed path
    // http://localhost:3000/data/albums/kuching/.resized_images/DSCF4490.JPG@2400.webp
    const imageSrc = result.path.replace("../src/public", "");
    const resized =
      [
        ...imageSrc.split("/").slice(0, -1),
        ".resized_images",
        ...imageSrc.split("/").slice(-1),
      ].join("/") + "@600.webp";
    const albumName = result.path.split("/").at(-2);

    return (
      <Link href={result.album_relative_path} className={styles.link}>
        <div className={styles.result}>
          <picture>
            <img
              className={styles.resultPicture}
              data-testid="result-picture"
              src={resized}
              alt={result.tags}
              style={{ backgroundColor: colour }}
            ></img>
          </picture>
          <div className={styles.details}>
            <div>
              <div
                className={styles.snippet}
                dangerouslySetInnerHTML={{ __html: result.snippet }}
                title={(result.bm25 * -1).toFixed(1)}
              />
              <div>{albumName}</div>
            </div>
          </div>
        </div>
      </Link>
    );
  };

  // Read query from URL on load
  useEffect(() => {
    const url = new URL(window.location.toString());
    const query = url.searchParams.get("q");
    if (query) {
      setSearchQuery(query);
    }
  }, []);

  // Set window URL query on change
  useEffect(() => {
    const searchParams = new URLSearchParams(window.location.search);
    searchParams.delete("q");
    if (debouncedSearchQuery) {
      searchParams.set("q", debouncedSearchQuery);
    }
    const url = new URL(window.location.toString());
    url.search = searchParams.toString();
    router.replace(url, undefined, { shallow: true });
  }, [debouncedSearchQuery]);

  // Register '/' to focus search
  useEffect(() => {
    function handler(ev: KeyboardEvent) {
      if (ev.key === "/") {
        inputRef.current?.focus();
        ev.preventDefault();
      }

      if (ev.key === "Escape") {
        inputRef.current?.blur();
      }

      if (ev.key === "Tab") {
        return true;
      }
    }
    window.addEventListener("keydown", handler);

    return () => {
      window.removeEventListener("keydown", handler);
    };
  }, []);

  const queryResults = results[debouncedSearchQuery];

  return (
    <div className={styles.searchWidget}>
      <div className={styles.searchInputRow}>
        <input
          type="text"
          value={searchQuery}
          placeholder="Type / to search (try burger, japan, 2020)"
          spellCheck={false}
          onChange={(ev) => {
            setSearchQuery(ev.target.value);
          }}
          disabled={props.disabled === true || !backend}
          ref={inputRef}
          tabIndex={0}
        />
      </div>

      <div>
        <ul className={styles.results}>
          {queryResults?.status === "done" &&
          debouncedSearchQuery.length < 3 ? (
            <div className={styles.searchHint}>
              Type a minimum of 3 characters
            </div>
          ) : null}

          {queryResults?.status === "searching" ? (
            <div className={styles.searchHint}>Searching&hellip;</div>
          ) : queryResults?.status === "done" ? (
            queryResults?.results.length === 0 &&
            debouncedSearchQuery.length >= 3 ? (
              <div key={debouncedSearchQuery}>
                No results for <i>{debouncedSearchQuery}</i>
              </div>
            ) : (
              <>
                {queryResults?.results.map((r) => {
                  return (
                    <li key={r.path} className={styles.resultLi}>
                      <SearchResult result={r} />
                    </li>
                  );
                })}
                {/* This logic is flawed as result sets with exactly PAGE_SIZE
                results will show this button, but we don't want to fire off an additional COUNT query*/}
                {queryResults?.results?.length % PAGE_SIZE === 0 &&
                queryResults?.results?.length > 0 ? (
                  <button
                    className={styles.moreButton}
                    onClick={() => {
                      setPage(page + 1);
                    }}
                  >
                    More&hellip;
                  </button>
                ) : null}
              </>
            )
          ) : (
            <div style={{ userSelect: "none" }}>&nbsp;</div>
          )}
        </ul>
      </div>
    </div>
  );
};

export default Search;
