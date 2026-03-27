import React, { useEffect, useRef, useState } from "react";
import { useDebounce } from "use-debounce";
import styles from "./Search.module.css";
import { useInfiniteQuery, keepPreviousData } from "@tanstack/react-query";
import {
  fetchResults,
  fetchSimilarResults,
  fetchTags,
  PaginatedSearchResult,
} from "./api";
import { SearchResultTile } from "./SearchResultTile";
import { SearchTag } from "./SearchTag";
import { useDatabase } from "../database/useDatabase";
import { ProgressBar } from "../ProgressBar";
import { getResizedAlbumImageSrc } from "../../util/getResizedAlbumImageSrc";

type Tag = {
  name: string;
  count: number;
};

type InitialSearchState = {
  searchQuery: string[];
  similarPath: string | null;
  hasHydratedFromUrl: boolean;
};

const getInitialSearchState = (): InitialSearchState => {
  if (typeof window === "undefined") {
    return {
      searchQuery: [],
      similarPath: null,
      hasHydratedFromUrl: false,
    };
  }

  const url = new URL(window.location.toString());
  const query = url.searchParams.get("q");

  return {
    searchQuery: query ? query.split(",").map((value) => value.trim()) : [],
    similarPath: url.searchParams.get("similar"),
    hasHydratedFromUrl: true,
  };
};

const getAlbumAnchorHref = (path: string): string => {
  const segments = path.split("/");
  const albumName = segments.at(-2);
  const filename = segments.at(-1);

  if (!albumName || !filename) {
    return "/search";
  }

  return `/album/${albumName}#${filename}`;
};

export const Search: React.FC<{ disabled?: boolean }> = (props) => {
  const PAGE_SIZE = 48;
  const [searchQuery, setSearchQuery] = useState<string[]>([]);
  const [similarPath, setSimilarPath] = useState<string | null>(null);
  const [similarTrail, setSimilarTrail] = useState<string[]>([]);
  const [hasHydratedFromUrl, setHasHydratedFromUrl] =
    useState<boolean>(false);
  const [debouncedSearchQuery] = useDebounce(searchQuery, 600);
  const inputRef = useRef<HTMLInputElement>(null);
  const [database, progress] = useDatabase();
  const isSimilarMode = Boolean(similarPath);
  const trimmedQuery = debouncedSearchQuery.join(" ").trim();
  const hasSearchQuery = trimmedQuery.length > 0;
  const similarFilename = similarPath?.split("/").at(-1) ?? null;
  const similarPreviewSrc = similarPath
    ? getResizedAlbumImageSrc(similarPath)
    : null;

  useEffect(() => {
    const initialSearchState = getInitialSearchState();
    setSearchQuery(initialSearchState.searchQuery);
    setSimilarPath(initialSearchState.similarPath);
    setHasHydratedFromUrl(initialSearchState.hasHydratedFromUrl);
  }, []);

  const reactQuery = useInfiniteQuery({
    queryKey: ["results", { debouncedSearchQuery, similarPath }],
    queryFn: async ({ pageParam }: { pageParam: number }) => {
      if (!database) {
        return {
          data: [],
          prev: undefined,
          next: undefined,
        };
      }

      if (similarPath) {
        return await fetchSimilarResults({
          database,
          path: similarPath,
          pageSize: PAGE_SIZE,
          page: pageParam,
        });
      }

      if (!hasSearchQuery) {
        return {
          data: [],
          prev: undefined,
          next: undefined,
        };
      }

      return await fetchResults({
        database,
        query: debouncedSearchQuery.join("|"),
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
      _allPages,
      lastPageParam,
    ) => {
      return (
        lastPage.next ??
        (lastPage.data.length === PAGE_SIZE ? lastPageParam + 1 : undefined)
      );
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
    if (!hasHydratedFromUrl || !fetchNextPage || !database) {
      return;
    }

    if (!similarPath && !hasSearchQuery) {
      return;
    }

    fetchNextPage();
  }, [
    database,
    fetchNextPage,
    hasHydratedFromUrl,
    hasSearchQuery,
    similarPath,
  ]);

  useEffect(() => {
    if (!hasHydratedFromUrl) {
      return;
    }

    const searchParams = new URLSearchParams(window.location.search);
    searchParams.delete("q");
    searchParams.delete("similar");

    if (similarPath) {
      searchParams.set("similar", similarPath);
    } else if (debouncedSearchQuery.length > 0) {
      searchParams.set("q", debouncedSearchQuery.join(","));
    }

    const url = new URL(window.location.toString());
    url.search = searchParams.toString();
    const nextRoute = `${url.pathname}${url.search}${url.hash}`;
    const currentRoute = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    if (nextRoute === currentRoute) {
      return;
    }

    try {
      window.history.replaceState(window.history.state, "", nextRoute);
    } catch (err) {
      console.warn("Failed to sync search URL", err);
    }
  }, [debouncedSearchQuery, hasHydratedFromUrl, similarPath]);

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

  const [tags, setTags] = React.useState<Tag[]>([]);
  useEffect(() => {
    if (!database) {
      return;
    }

    fetchTags({ database, page: 0, pageSize: 1000, minCount: 1 })
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
  const canClear = isSimilarMode || searchQuery.join("").trim() !== "";

  return (
    <div className={styles.searchWidget}>
      <div className={styles.searchInputRow}>
        <div className={styles.searchInputContainer}>
          <input
            suppressHydrationWarning
            type="text"
            value={searchQuery.join(",")}
            placeholder="Type / to search (try bird, model:mavica, datetime:2023)"
            spellCheck={false}
            autoFocus
            onChange={(ev) => {
              setSimilarPath(null);
              setSimilarTrail([]);
              setSearchQuery(ev.target.value.split(",").map((s) => s.trim()));
            }}
            ref={inputRef}
            tabIndex={0}
            title={
              props.disabled || !database
                ? "Disabled: the SQLite WASM failed to load, your browser does not support service workers, or the server is missing the proper COEP/COOP headers"
                : undefined
            }
          />
          {canClear ? (
            <button
              className={styles.clearButton}
              onClick={() => {
                setSearchQuery([]);
                setSimilarPath(null);
                setSimilarTrail([]);
              }}
              title="Clear search"
              type="button"
            >
              ×
            </button>
          ) : null}
        </div>
      </div>

      <ProgressBar progress={progress} />

      {isSimilarMode ? (
        <div className={styles.modeBar}>
          <div className={styles.modeMetaLabel} style={{ width: "100%" }}>
            Similar photos
          </div>
          <div className={styles.modeStack}>
            {similarTrail.length > 0 ? (
              <div
                className={styles.breadcrumbs}
                aria-label="Similarity breadcrumbs"
              >
                {similarTrail.map((path, idx) => {
                  const label = path.split("/").at(-1) ?? path;
                  const opacity =
                    0.35 + (0.55 * (idx + 1)) / similarTrail.length;
                  const isLatestBreadcrumb = idx === similarTrail.length - 1;
                  const preview = (
                    <img
                      className={styles.breadcrumbPreview}
                      src={getResizedAlbumImageSrc(path)}
                      alt=""
                    />
                  );

                  if (isLatestBreadcrumb) {
                    return (
                      <a
                        key={`${path}-${idx}`}
                        className={styles.breadcrumbButton}
                        style={{ opacity }}
                        href={getAlbumAnchorHref(path)}
                        title={`Open ${label}`}
                        aria-label={label}
                      >
                        {preview}
                      </a>
                    );
                  }

                  return (
                    <button
                      key={`${path}-${idx}`}
                      type="button"
                      className={styles.breadcrumbButton}
                      style={{ opacity }}
                      onClick={() => {
                        setSimilarPath(path);
                        setSimilarTrail((prev) => prev.slice(0, idx));
                      }}
                      title={label}
                      aria-label={label}
                    >
                      {preview}
                    </button>
                  );
                })}
              </div>
            ) : null}
            <div className={styles.modeSource}>
              {similarPreviewSrc ? (
                <img
                  className={styles.modeSourcePreview}
                  src={similarPreviewSrc}
                  alt={`Source photo ${similarFilename ?? ""}`}
                />
              ) : null}
              <div className={styles.modeSourceMeta}>
                <div className={styles.modeMetaLabel}>Comparing against</div>
                <div className={styles.modeMeta}>{similarFilename}</div>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      <div className={styles.tagsContainer}>
        {Object.values(
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
            {} as Record<string, Tag>,
          ),
        ).map((tag) => {
          const isActive = searchQuery.includes(tag.name.toLocaleLowerCase());
          return (
            <SearchTag
              key={tag.name}
              tag={tag.name}
              count={tag.count - 1}
              isActive={isActive}
              onClick={() => {
                setSimilarPath(null);
                setSimilarTrail([]);
                setSearchQuery((prev) =>
                  isActive
                    ? prev.filter(
                        (t) => t && t !== tag.name.toLocaleLowerCase(),
                      )
                    : [...prev.filter((t) => t), tag.name.toLocaleLowerCase()],
                );
              }}
            />
          );
        })}
      </div>

      <div>
        <ul className={styles.results}>
          {isSimilarMode || searchQuery.length > 0 ? (
            <>
              {isSuccess &&
              !isFetching &&
              queryResults?.length === 0 &&
              isSimilarMode ? (
                <div>
                  No similar results for <i>{similarPath?.split("/").at(-1)}</i>
                </div>
              ) : null}

              {isSuccess &&
              !isFetching &&
              queryResults?.length === 0 &&
              !isSimilarMode &&
              trimmedQuery.length >= 3 ? (
                <div>
                  No results for <i>{trimmedQuery}</i>
                </div>
              ) : null}

              {isSuccess &&
              !isFetching &&
              !isSimilarMode &&
              trimmedQuery.length < 3 &&
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
                    <SearchResultTile
                      result={r}
                      onFindSimilar={(path) => {
                        if (path === similarPath) {
                          return;
                        }

                        setSearchQuery([]);
                        setSimilarTrail((prev) => {
                          if (!similarPath) {
                            return prev;
                          }

                          return [...prev, similarPath];
                        });
                        setSimilarPath(path);
                      }}
                    />
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

              {isFetching && !isSuccess ? <div>Searching&hellip;</div> : null}
            </>
          ) : null}
        </ul>
      </div>
    </div>
  );
};

export default Search;
