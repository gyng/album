import React, { useEffect, useRef, useState } from "react";
import { useDebounce } from "use-debounce";
import styles from "./Search.module.css";
import { useRouter } from "next/router";
import { useInfiniteQuery, keepPreviousData } from "@tanstack/react-query";
import { fetchResults, fetchTags, PaginatedSearchResult } from "./api";
import { SearchResultTile } from "./SearchResultTile";
import { SearchTag } from "./SearchTag";
import { useDatabase } from "../database/useDatabase";

type Tag = {
  name: string;
  count: number;
};

export const Search: React.FC<{ disabled?: boolean }> = (props) => {
  const PAGE_SIZE = 48;
  const router = useRouter();

  const [searchQuery, setSearchQuery] = useState<string>("");
  const [debouncedSearchQuery] = useDebounce(searchQuery, 600);
  const inputRef = useRef<HTMLInputElement>(null);
  const [database, progress] = useDatabase();

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
      lastPageParam
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
        `database not initialised, retrying "${debouncedSearchQuery}"`
      );
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

    fetchTags({ database, page: 0, pageSize: 1000, minCount: 1 })
      .then((results) => {
        setTags(
          results.data
            .map((r) => ({ name: r.tag, count: r.count }))
            .filter((t) => t.name.length >= 3)
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
          placeholder="Type / to search (try bird, model:mavica, datetime:2023)"
          spellCheck={false}
          autoFocus
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

      {progress < 100 ? (
        <div style={{ display: "block" }}>
          <div className={styles.progressBar}>
            <div
              className={styles.progress}
              style={{ width: `${progress}%` }}
            />
            <div>Loading tags&hellip;</div>
          </div>
        </div>
      ) : null}

      <div className={styles.tagsContainer}>
        {Object.values(
          // Combine tags with the same name but different casing
          tags.reduce(
            (acc, tag) => {
              const key = tag.name.toLocaleLowerCase();
              if (!acc[key]) {
                acc[key] = { ...tag };
              } else {
                acc[key].count += tag.count;
              }
              return acc;
            },
            {} as Record<string, Tag>
          )
        ).map((tag) => {
          return (
            <SearchTag
              key={tag.name}
              tag={tag.name}
              count={tag.count - 1}
              isActive={
                tag.name.toLocaleLowerCase() === searchQuery.toLocaleLowerCase()
              }
              onClick={() => {
                setSearchQuery(tag.name.toLocaleLowerCase());
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
