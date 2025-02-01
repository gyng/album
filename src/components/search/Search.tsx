import React, { useEffect, useRef, useState } from "react";
import { useDebounce } from "use-debounce";
import styles from "./Search.module.css";
import { useRouter } from "next/router";
import { useInfiniteQuery, keepPreviousData } from "@tanstack/react-query";
import { fetchResults, fetchTags, PaginatedSearchResult } from "./api";
import { SearchResultTile } from "./SearchResultTile";
import { SearchTag } from "./SearchTag";

import sqlite3InitModule, {
  Database,
  Sqlite3Static,
} from "@sqlite.org/sqlite-wasm";

type Tag = {
  name: string;
  count: number;
};

const loadRemoteDatabase = async (sqlite3: Sqlite3Static) => {
  console.log("Running SQLite3 version", sqlite3.version.libVersion);
  return fetch("/search.sqlite")
    .then((res) => res.arrayBuffer())
    .then(function (arrayBuffer) {
      const p = sqlite3.wasm.allocFromTypedArray(arrayBuffer);
      const db = new sqlite3.oo1.DB();
      if (db.pointer) {
        const rc = sqlite3.capi.sqlite3_deserialize(
          db.pointer,
          "main",
          p,
          arrayBuffer.byteLength,
          arrayBuffer.byteLength,
          sqlite3.capi.SQLITE_DESERIALIZE_FREEONCLOSE,
          // Optionally:
          // | sqlite3.capi.SQLITE_DESERIALIZE_RESIZEABLE
        );
        db.checkRc(rc);
        return db;
      } else {
        throw new Error("Database pointer is undefined");
      }
    });
};

const initializeSQLite = async (): Promise<Database> => {
  let db;
  try {
    console.log("Loading and initializing SQLite3 module...");
    const sqlite3 = await sqlite3InitModule({
      print: console.log,
      printErr: console.error,
    });
    db = loadRemoteDatabase(sqlite3);
  } catch (err) {
    if (err instanceof Error) {
      console.error("Initialization error:", err.name, err.message);
    } else {
      console.error("Initialization error:", err);
    }
  }

  if (!db) {
    throw new Error("Failed to initialise SQLite");
  }

  return db;
};

export const Search: React.FC<{ disabled?: boolean }> = (props) => {
  const PAGE_SIZE = 48;
  const router = useRouter();

  const [searchQuery, setSearchQuery] = useState<string>("");
  const [debouncedSearchQuery] = useDebounce(searchQuery, 600);
  const inputRef = useRef<HTMLInputElement>(null);

  const [database, setDatabase] = useState<Database | null>(null);
  useEffect(() => {
    initializeSQLite().then((db) => {
      setDatabase(db);
    });
  }, []);

  const reactQuery = useInfiniteQuery({
    queryKey: ["results", { debouncedSearchQuery }],
    queryFn: async ({ pageParam }: { pageParam: number }) => {
      if (!database) {
        console.log("Database not initialised");
        return {
          data: [],
          prev: undefined,
          next: undefined,
        };
      }
      return await fetchResults({
        database: database,
        query: debouncedSearchQuery,
        pageSize: PAGE_SIZE,
        page: pageParam,
      });
    },
    initialPageParam: 0,
    enabled: false,
    placeholderData: keepPreviousData,
    getPreviousPageParam: (firstPage: PaginatedSearchResult) => {
      return firstPage.prev ?? undefined;
    },
    getNextPageParam: (
      lastPage: PaginatedSearchResult,
      allPages,
      lastPageParam,
    ) => {
      // Hack to show next page: not 100% correct as sometimes results can only have 1 page
      return lastPage.data.length === PAGE_SIZE ? lastPageParam + 1 : undefined;
      // TODO: Update SQLITE to return cursor or next page if it exists
      // return lastPage.next ?? undefined;
    },
  });

  const {
    data,
    fetchNextPage,
    hasNextPage,
    isSuccess,
    isFetching,
    isPlaceholderData,
  } = reactQuery;

  useEffect(() => {
    if (!fetchNextPage) {
      // Not initialised yet
      return;
    }

    if (!debouncedSearchQuery) {
      // Bug: The react-query cache is not updated
      // and leads to stale results being present when the input is focused on again
      // Calling remove() on react-query doesn't seem to help
      return;
    }

    if (!database) {
      console.log(
        `window.db not initialised, retrying "${debouncedSearchQuery}"`,
      );

      // FF in private browsing doesn't allow access to navigator.serviceWorker
      if (navigator?.serviceWorker) {
        // Assume COOP/COEP service worker isn't up
        // Give some time for service worker to init
        setTimeout(() => {
          // set search params to count reloads
          const url = new URL(window.location.toString());
          const searchParams = new URLSearchParams(window.location.search);

          if (!searchParams.has("reload")) {
            searchParams.set("reload", "1");
            url.search = searchParams.toString();
            // window.location.reload();
          }
        }, 2000);
      } else {
        console.log("navigator.serviceWorker not supported");
      }
      return;
    } else {
      fetchNextPage();
    }
  }, [debouncedSearchQuery, fetchNextPage]);

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
    if (router) {
      router.replace(url, undefined, { shallow: true });
    }
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

  // Fetch tags as suggestions
  const [tags, setTags] = React.useState<Tag[]>([]);
  useEffect(() => {
    if (!database) {
      console.log("Database not initialised");
      return;
    }

    fetchTags({ database, page: 0, pageSize: 1000, minCount: 5 })
      .then((results) => {
        setTags(
          results.data
            .map((r) => ({ name: r.tag, count: r.count }))
            .filter((t) => t.name.length >= 3),
        );
      })
      .catch(console.error);
  }, [database]);

  const queryResults = data?.pages.flatMap((page) => page.data);

  return (
    <div className={styles.searchWidget}>
      <div className={styles.searchInputRow}>
        <input
          suppressHydrationWarning
          type="text"
          value={searchQuery}
          placeholder="Type / to search (try burger, japan, datetime:2023)"
          spellCheck={false}
          onChange={(ev) => {
            setSearchQuery(ev.target.value);
          }}
          // disabled={props.disabled === true || !backend}
          ref={inputRef}
          tabIndex={0}
          title={
            props.disabled || !database
              ? "Disabled: the SQLite WASM failed to load, your browser does not support service workers, or the server is missing the proper COEP/COOP headers"
              : undefined
          }
        />
      </div>

      <div className={styles.tagsContainer}>
        {tags.length === 0 ? <div>Loading tags&hellip;</div> : null}
        {tags.map((tag) => {
          return (
            <SearchTag
              key={tag.name}
              tag={tag.name}
              count={tag.count}
              onClick={() => {
                setSearchQuery(tag.name);
              }}
            />
          );
        })}
      </div>

      <div>
        <ul className={styles.results}>
          {searchQuery ? (
            <>
              {isSuccess &&
              !isFetching &&
              queryResults?.length === 0 &&
              // Needs to be 3 due to fts5?
              debouncedSearchQuery.length >= 3 ? (
                <div>
                  No results for <i>{debouncedSearchQuery}</i>
                </div>
              ) : null}

              {isSuccess &&
              !isFetching &&
              // Needs to be 3 due to fts5?
              debouncedSearchQuery.length < 3 &&
              queryResults?.length === 0 ? (
                <div className={styles.searchHint}>
                  Type a minimum of 3 characters
                </div>
              ) : null}

              {queryResults?.map((r) => {
                return (
                  <li
                    key={r.path}
                    className={styles.resultLi}
                    style={{
                      filter: isPlaceholderData
                        ? "saturate(0.5)"
                        : "saturate(1)",
                    }}
                  >
                    <SearchResultTile result={r} />
                  </li>
                );
              })}

              {hasNextPage && isSuccess ? (
                <button
                  className={styles.moreButton}
                  onClick={() => {
                    fetchNextPage();
                  }}
                  disabled={isFetching}
                >
                  {isFetching ? <>Loading&hellip;</> : <>More&hellip;</>}
                </button>
              ) : null}

              {/* First fetch */}
              {isFetching && !isSuccess ? <div>Searching&hellip;</div> : null}
            </>
          ) : null}
        </ul>
      </div>
    </div>
  );
};

export default Search;
