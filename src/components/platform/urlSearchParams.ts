type Query = Record<string, string | string[] | undefined>;

const dynamicRouteParamNames = (pathname: string): Set<string> =>
  new Set([...pathname.matchAll(/\[{1,2}(?:\.\.\.)?([^\]]+)\]{1,2}/g)].map((match) => match[1]));

export const queryToSearchParams = (query: Query, pathname: string): URLSearchParams => {
  const params = new URLSearchParams();
  const routeParams = dynamicRouteParamNames(pathname);
  for (const [name, value] of Object.entries(query)) {
    if (routeParams.has(name)) continue;
    if (Array.isArray(value)) {
      for (const item of value) params.append(name, item);
    } else if (value !== undefined) {
      params.set(name, value);
    }
  }
  return params;
};

export const splitHref = (href: string): { path: string; search: string; hash: string } => {
  const hashAt = href.indexOf("#");
  const hash = hashAt === -1 ? "" : href.slice(hashAt);
  const pathAndSearch = hashAt === -1 ? href : href.slice(0, hashAt);
  const searchAt = pathAndSearch.indexOf("?");
  return {
    path: searchAt === -1 ? pathAndSearch : pathAndSearch.slice(0, searchAt),
    search: searchAt === -1 ? "" : pathAndSearch.slice(searchAt + 1),
    hash,
  };
};
