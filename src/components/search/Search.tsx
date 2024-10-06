import React, { useEffect, useRef, useState } from "react";
import { createSQLiteThread, createHttpBackend } from "sqlite-wasm-http";
import { useDebounce } from "use-debounce";
import styles from "./Search.module.css";
import { Backend } from "sqlite-wasm-http/dist/vfs-http-types";
import { useRouter } from "next/router";
import { useInfiniteQuery, keepPreviousData } from "@tanstack/react-query";
import { fetchResults, PaginatedSearchResult } from "./api";
import { SearchResultTile } from "./SearchResultTile";

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
  const PAGE_SIZE = 24;
  const router = useRouter();

  const [backend, setBackend] = useState<ReturnType<
    typeof createHttpBackend
  > | null>(null);

  const [searchQuery, setSearchQuery] = useState<string>("");
  const [debouncedSearchQuery] = useDebounce(searchQuery, 600);
  const inputRef = useRef<HTMLInputElement>(null);

  const reactQuery = useInfiniteQuery({
    queryKey: ["results", { debouncedSearchQuery }],
    queryFn: async ({ pageParam }: { pageParam: number }) =>
      await fetchResults({
        query: debouncedSearchQuery,
        pageSize: PAGE_SIZE,
        page: pageParam,
      }),
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

    if (!window.db) {
      console.log(
        `window.db not initialised, retrying "${debouncedSearchQuery}"`,
      );

      // FF in private browsing doesn't allow access to navigator.serviceWorker
      if (navigator?.serviceWorker) {
        // Assume COOP/COEP service worker isn't up
        // Give some time for service worker to init
        setTimeout(() => {
          window.location.reload();
        }, 1000);
      } else {
        console.log("navigator.serviceWorker not supported");
      }
      return;
    } else {
      fetchNextPage();
    }
  }, [debouncedSearchQuery, fetchNextPage]);

  useEffect(() => {
    const httpBackend = initBackend();
    setBackend(httpBackend);
  }, []);

  // Need to split initialisation out as the library doesn't guarantee that the backend worker is ready
  useEffect(() => {
    if (!backend || !backend.worker || window.db) {
      return;
    }
    initDb(backend).catch(console.error);
  }, [backend, backend?.worker]);

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
          disabled={props.disabled === true || !backend}
          ref={inputRef}
          tabIndex={0}
          title={
            props.disabled || !backend
              ? "Disabled: the SQLite WASM failed to load, your browser does not support service workers, or the server is missing the proper COEP/COOP headers"
              : undefined
          }
        />
      </div>

      <div>
        <ul className={styles.results}>
          {searchQuery ? (
            <>
              {isSuccess &&
              !isFetching &&
              queryResults?.length === 0 &&
              debouncedSearchQuery.length >= 3 ? (
                <div>
                  No results for <i>{debouncedSearchQuery}</i>
                </div>
              ) : null}

              {isSuccess &&
              !isFetching &&
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
