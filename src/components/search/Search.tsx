import React, { useEffect, useState } from "react";
import { createSQLiteThread, createHttpBackend } from "sqlite-wasm-http";
import { useDebounce } from "use-debounce";
import styles from "./Search.module.css";
import Link from "next/link";
import { Backend } from "sqlite-wasm-http/dist/vfs-http-types";

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
      // Using setState crashes
      // setDb(d);
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
  const [backend, setBackend] = useState<ReturnType<
    typeof createHttpBackend
  > | null>(null);
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [debouncedSearchQuery] = useDebounce(searchQuery, 600);

  const [latestExecId, setLatestExecId] = useState<string>("");
  const [execStatus, setExecStatus] = useState<Record<string, string>>({});

  const [results, setResults] = useState<any[]>([]);

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

  const doSearch = async (query: string, tries = 3) => {
    let firstEventHandled = false;

    if (!query) {
      return;
    }

    if (window.db && query) {
      const exec = await window.db("exec", {
        sql: `SELECT *, snippet(images, -1, '<i class="snippet">', '</i>', '…', 24) AS snippet, bm25(images) AS bm25 FROM images WHERE images MATCH ? ORDER BY rank LIMIT 24`,
        bind: [`- {path album_relative_path} : ${query}`],
        callback: (msg: any) => {
          if (msg.row) {
            const record: Record<string, string> = {};
            (msg.columnNames as Array<string>).forEach((cn, i) => {
              record[cn] = msg.row[i];
            });
            record.type = msg.type;

            if (!firstEventHandled) {
              firstEventHandled = true;
              setResults(() => [record]);
            } else {
              setResults((cur) => {
                return [...cur, record].filter(
                  (thing, i, arr) =>
                    arr.findIndex((t) => t.path === thing.path) === i
                );
              });
            }
          } else {
            const sourceExecId = msg.type.split(":")[0];
            setExecStatus((cur) => ({ ...cur, [sourceExecId]: "done" }));
          }
        },
      });
      setLatestExecId(() => exec.messageId);
    } else {
      if (!window.db) {
        console.log(`window.db not initialised, retrying "${query}"`);
        setTimeout(() => {
          if (tries > 0) {
            return doSearch(query, tries - 1);
          }
        }, 2000);
      }
    }
  };

  useEffect(() => {
    const predictedIdNumber = latestExecId
      ? Number.parseInt(latestExecId.split("#").at(-1) ?? "-1") + 1
      : latestExecId;
    const predictedExecId = `exec#${predictedIdNumber}`;
    setExecStatus((cur) => {
      // Already completed before React got here
      if (cur[predictedExecId] === "done") {
        return cur;
      }
      return { ...cur, [predictedExecId]: "done" };
    });

    setResults([]);
    doSearch(searchQuery);
  }, [debouncedSearchQuery]);

  const SearchResult = (props: {
    result: {
      path: string;
      album_relative_path: string;
      snippet: string;
      bm25: number;
      tags: string;
    };
  }) => {
    const { result } = props;
    // hack, assumed path
    // http://localhost:3000/data/albums/kuching/.resized_images/DSCF4490.JPG@2400.webp
    const imageSrc = result.path.replace("../src/public", "");
    const resized =
      [
        ...imageSrc.split("/").slice(0, -1),
        ".resized_images",
        ...imageSrc.split("/").slice(-1),
      ].join("/") + "@400.webp";
    const albumName = result.path.split("/").at(-2);

    return (
      <div className={styles.result}>
        <Link href={result.album_relative_path} className={styles.link}>
          <img
            className={styles.resultPicture}
            data-testid="result-picture"
            src={resized}
            alt={result.tags}
          ></img>
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
        </Link>
      </div>
    );
  };

  const doneSearching = execStatus[latestExecId] === "done";
  const latestResults = results.filter((r) => r.type.startsWith(latestExecId));

  return (
    <div className={styles.search}>
      <input
        type="text"
        value={searchQuery}
        placeholder="Search (try burger, japan, x100)"
        spellCheck={false}
        onChange={(ev) => {
          setSearchQuery(ev.target.value);
        }}
        disabled={props.disabled === true || !backend}
      />
      {searchQuery.length > 0 && results.length > 0 ? (
        <div>
          <ul className={styles.results}>
            {searchQuery.length < 3 && latestResults.length === 0 ? (
              <div className={styles.searchHint}>
                Type a minimum of 3 characters
              </div>
            ) : (
              latestResults.map((r) => {
                return (
                  <li key={r.path} className={styles.resultLi}>
                    <SearchResult result={r} />
                  </li>
                );
              })
            )}
          </ul>
        </div>
      ) : searchQuery.length > 0 &&
        debouncedSearchQuery.length > 0 &&
        doneSearching ? (
        <div className={styles.transitionHack} key={debouncedSearchQuery}>
          No results for <i>{debouncedSearchQuery}</i>
        </div>
      ) : searchQuery.length > 0 && latestExecId ? (
        <div>Searching&hellip;</div>
      ) : (
        <div style={{ userSelect: "none" }}>&nbsp;</div>
      )}
    </div>
  );
};

export default Search;
