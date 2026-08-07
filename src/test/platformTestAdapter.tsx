import type React from "react";
import type { ClientComponents, PlatformAdapter } from "../components/platform";

const NullComponent = () => null;

export const createPlatformAdapter = (
  overrides: Partial<PlatformAdapter> & { clientComponents?: Partial<ClientComponents> } = {},
): PlatformAdapter => ({
  Link: (({ children, ...props }: React.ComponentProps<"a">) => (
    <a {...props}>{children}</a>
  )) as PlatformAdapter["Link"],
  Head: ({ children }) => children,
  navigation: {
    ready: true,
    searchParams: new URLSearchParams(),
    getSearchParam: () => null,
    hasSearchParam: () => false,
    replaceSearchParams: () => {},
    subscribeAfterNavigation: () => () => {},
  },
  publicConfig: {
    siteOrigin: "https://photos.example.com",
    searchDatabaseUrl: "/search.sqlite",
    searchEmbeddingsDatabaseUrl: "/search-embeddings.sqlite",
  },
  ...overrides,
  // Every key the contract requires, then the caller's overrides. Two were
  // missing (`EmbeddingSpace`, `TripRouteMap`), which left them optional in the
  // result and so not a `ClientComponents` at all — invisible until something
  // actually typechecked the test tree.
  clientComponents: {
    ContactSheet: NullComponent,
    EmbeddingSpace: NullComponent,
    Map: NullComponent,
    MapWorld: NullComponent,
    PhotoSimilarPhotos: NullComponent,
    SankeyChart: NullComponent,
    TripRouteMap: NullComponent,
    GuessMap: NullComponent,
    SearchWithCoi: NullComponent,
    ...overrides.clientComponents,
  },
});
