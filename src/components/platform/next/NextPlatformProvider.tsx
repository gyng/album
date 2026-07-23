import Head from "next/head";
import NextLink from "next/link";
import { useRouter } from "next/router";
import React from "react";
import { PlatformProvider } from "../context";
import type { PlatformAdapter, PlatformHead, PlatformLink } from "../types";
import { queryToSearchParams, splitHref } from "../urlSearchParams";
import { nextClientComponents } from "./nextClientComponents";
import { getSiteOrigin } from "../../../lib/seo";

const EMPTY_QUERY = {};

const NextAppLink: PlatformLink = React.forwardRef(function NextAppLink(
  { onMouseEnter, onTouchStart, onClick, ...rest },
  ref,
) {
  // Next's LinkProps types these handlers without `| undefined`, so omit them
  // when absent rather than forwarding an explicit undefined (exactOptionalPropertyTypes).
  return (
    <NextLink
      {...rest}
      {...(onMouseEnter ? { onMouseEnter } : {})}
      {...(onTouchStart ? { onTouchStart } : {})}
      {...(onClick ? { onClick } : {})}
      ref={ref}
    />
  );
});

const NextDocumentHead: PlatformHead = ({ children }) => <Head>{children}</Head>;
export const NextPlatformProvider = ({ children }: React.PropsWithChildren): React.ReactElement => {
  const { asPath, events, isReady, pathname, query, replace } = useRouter();
  const routePathname = typeof pathname === "string" && pathname ? pathname : "/";
  const routeQuery = query ?? EMPTY_QUERY;
  const hasConcretePath = typeof asPath === "string" && asPath.length > 0;
  const querySearchParams = React.useMemo(
    () => queryToSearchParams(routeQuery, routePathname),
    [routePathname, routeQuery],
  );
  const pathSearchParams = React.useMemo(
    () => (hasConcretePath ? new URLSearchParams(splitHref(asPath).search) : null),
    [asPath, hasConcretePath],
  );
  const searchParams = pathSearchParams ?? querySearchParams;
  const getSearchParam = React.useCallback(
    (name: string) => {
      const values = searchParams.getAll(name);
      // invariant: length check guarantees the single value is present
      return values.length === 1 ? values[0]! : null;
    },
    [searchParams],
  );
  const hasSearchParam = React.useCallback(
    (name: string) => searchParams.has(name),
    [searchParams],
  );
  const replaceSearchParams = React.useCallback(
    (next: URLSearchParams) => {
      const current = splitHref(hasConcretePath ? asPath : routePathname);
      const nextSearch = next.toString();
      const nextHref = `${current.path}${nextSearch ? `?${nextSearch}` : ""}${current.hash}`;
      void replace(nextHref, undefined, { shallow: true });
    },
    [asPath, hasConcretePath, replace, routePathname],
  );
  const subscribeAfterNavigation = React.useCallback(
    (callback: () => void) => {
      events.on("routeChangeComplete", callback);
      return () => events.off("routeChangeComplete", callback);
    },
    [events],
  );
  const platform = React.useMemo<PlatformAdapter>(
    () => ({
      Link: NextAppLink,
      Head: NextDocumentHead,
      publicConfig: {
        siteOrigin: getSiteOrigin(process.env.NEXT_PUBLIC_SITE_URL),
        searchDatabaseUrl: process.env.NEXT_PUBLIC_SEARCH_DATABASE_URL ?? "/search.sqlite",
        searchEmbeddingsDatabaseUrl:
          process.env.NEXT_PUBLIC_SEARCH_EMBEDDINGS_DATABASE_URL ?? "/search-embeddings.sqlite",
      },
      clientComponents: nextClientComponents,
      navigation: {
        ready: isReady,
        searchParams,
        getSearchParam,
        hasSearchParam,
        replaceSearchParams,
        subscribeAfterNavigation,
      },
    }),
    [
      getSearchParam,
      hasSearchParam,
      isReady,
      replaceSearchParams,
      searchParams,
      subscribeAfterNavigation,
    ],
  );

  return <PlatformProvider value={platform}>{children}</PlatformProvider>;
};
