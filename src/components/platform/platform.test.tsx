/**
 * @jest-environment jsdom
 */

import { act, render, renderHook, screen } from "@testing-library/react";
import React from "react";

const mockReplace = jest.fn();
const mockOn = jest.fn();
const mockOff = jest.fn();
const mockUseRouter = jest.fn();

jest.mock("next/router", () => ({
  useRouter: () => mockUseRouter(),
}));

import { AppLink } from "./AppLink";
import { BrowserPlatformProvider } from "./browser";
import { DocumentHead } from "./DocumentHead";
import { PlatformProvider, useClientComponents, usePublicConfig } from "./context";
import { useAfterNavigation, useUrlSearchParams } from "./navigation";
import { NextPlatformProvider } from "./next/NextPlatformProvider";
import type { PlatformAdapter } from "./types";
import { createPlatformAdapter } from "../../test/platformTestAdapter";

const nextWrapper = ({ children }: React.PropsWithChildren) => (
  <NextPlatformProvider>{children}</NextPlatformProvider>
);

describe("platform navigation adapter", () => {
  beforeEach(() => {
    mockReplace.mockReset().mockResolvedValue(true);
    mockOn.mockReset();
    mockOff.mockReset();
    mockUseRouter.mockReturnValue({
      pathname: "/map",
      asPath: "/map?filter_album=trip&tag=one&tag=two",
      query: { filter_album: "trip", tag: ["one", "two"] },
      isReady: true,
      replace: mockReplace,
      events: { on: mockOn, off: mockOff },
    });
  });

  it("falls back to framework query values without exposing dynamic route parameters", () => {
    mockUseRouter.mockReturnValue({
      pathname: "/album/[[...slug]]",
      query: {
        slug: ["singapore"],
        album: "trip",
        tag: ["one", "two"],
        absent: undefined,
      },
      isReady: false,
      replace: mockReplace,
      events: { on: mockOn, off: mockOff },
    });
    const { result } = renderHook(() => useUrlSearchParams(), { wrapper: nextWrapper });

    expect(result.current.ready).toBe(false);
    expect(result.current.searchParams.get("album")).toBe("trip");
    expect(result.current.searchParams.getAll("tag")).toEqual(["one", "two"]);
    expect(result.current.searchParams.has("slug")).toBe(false);
    expect(result.current.searchParams.has("absent")).toBe(false);
  });

  it("exposes URLSearchParams and replaces them without leaking Next router arguments", () => {
    const { result } = renderHook(() => useUrlSearchParams(), { wrapper: nextWrapper });

    expect(result.current.ready).toBe(true);
    expect(result.current.searchParams.get("filter_album")).toBe("trip");
    expect(result.current.searchParams.getAll("tag")).toEqual(["one", "two"]);
    expect(result.current.getSearchParam("filter_album")).toBe("trip");
    expect(result.current.getSearchParam("tag")).toBeNull();
    expect(result.current.hasSearchParam("tag")).toBe(true);

    const next = new URLSearchParams("tag=one&tag=two&date=2026-07-16");
    act(() => {
      result.current.replaceSearchParams(next);
    });

    expect(mockReplace).toHaveBeenCalledWith("/map?tag=one&tag=two&date=2026-07-16", undefined, {
      shallow: true,
    });
  });

  it("excludes dynamic path parameters and preserves the concrete path and hash", () => {
    mockUseRouter.mockReturnValue({
      pathname: "/album/[[...slug]]",
      asPath: "/album/singapore?tag=night&tag=market#hawker.jpg",
      query: { slug: ["singapore"], tag: ["night", "market"] },
      isReady: true,
      replace: mockReplace,
      events: { on: mockOn, off: mockOff },
    });

    const { result } = renderHook(() => useUrlSearchParams(), { wrapper: nextWrapper });

    expect(result.current.hasSearchParam("slug")).toBe(false);
    expect(result.current.searchParams.getAll("tag")).toEqual(["night", "market"]);

    act(() => {
      result.current.replaceSearchParams(new URLSearchParams("view=grid"));
    });

    expect(mockReplace).toHaveBeenCalledWith("/album/singapore?view=grid#hawker.jpg", undefined, {
      shallow: true,
    });
  });

  it("keeps search parameter identity stable when only the framework query object changes", () => {
    const router = {
      pathname: "/map",
      asPath: "/map?filter_album=trip",
      query: { filter_album: "trip" },
      isReady: true,
      replace: mockReplace,
      events: { on: mockOn, off: mockOff },
    };
    mockUseRouter.mockReturnValue(router);
    const { result, rerender } = renderHook(() => useUrlSearchParams(), {
      wrapper: nextWrapper,
    });
    const first = result.current.searchParams;

    mockUseRouter.mockReturnValue({ ...router, query: { filter_album: "trip" } });
    rerender();

    expect(result.current.searchParams).toBe(first);
  });

  it("subscribes to completed client navigations and cleans up", () => {
    const callback = jest.fn();
    const { unmount } = renderHook(() => useAfterNavigation(callback), { wrapper: nextWrapper });

    expect(mockOn).toHaveBeenCalledWith("routeChangeComplete", callback);
    unmount();
    expect(mockOff).toHaveBeenCalledWith("routeChangeComplete", callback);
  });

  it("accepts a renderer-owned adapter without loading Next contracts at call sites", () => {
    const replaceSearchParams = jest.fn();
    const Link = React.forwardRef<HTMLAnchorElement, React.ComponentProps<"a">>(function TestLink(
      { children, ...props },
      ref,
    ) {
      return (
        <a {...props} ref={ref} data-renderer="test">
          {children}
        </a>
      );
    });
    const adapter: PlatformAdapter = createPlatformAdapter({
      Link,
      Head: ({ children }) => <section data-testid="head">{children}</section>,
      publicConfig: {
        siteOrigin: "https://portable.example.com",
        searchDatabaseUrl: "/portable-search.sqlite",
        searchEmbeddingsDatabaseUrl: "/portable-embeddings.sqlite",
      },
      navigation: {
        ready: true,
        searchParams: new URLSearchParams("theme=paper"),
        getSearchParam: (name) => (name === "theme" ? "paper" : null),
        hasSearchParam: (name) => name === "theme",
        replaceSearchParams,
        subscribeAfterNavigation: () => () => {},
      },
    });

    const Probe = () => {
      const navigation = useUrlSearchParams();
      const config = usePublicConfig();
      return (
        <>
          <DocumentHead>
            <span>Portable head</span>
          </DocumentHead>
          <AppLink href="/map">Map</AppLink>
          <output>{navigation.getSearchParam("theme")}</output>
          <output>{config.searchDatabaseUrl}</output>
        </>
      );
    };
    render(
      <PlatformProvider value={adapter}>
        <Probe />
      </PlatformProvider>,
    );

    expect(screen.getByRole("link", { name: "Map" })).toHaveAttribute("data-renderer", "test");
    expect(screen.getByTestId("head")).toHaveTextContent("Portable head");
    expect(screen.getByText("paper")).toBeInTheDocument();
    expect(screen.getByText("/portable-search.sqlite")).toBeInTheDocument();
  });

  it("provides functional browser defaults when no renderer adapter is installed", () => {
    window.history.replaceState(null, "", "/guess?daily#round");
    const callback = jest.fn();
    const { result } = renderHook(() => {
      useAfterNavigation(callback);
      return useUrlSearchParams();
    });

    expect(result.current.ready).toBe(true);
    expect(result.current.hasSearchParam("daily")).toBe(true);
    act(() => {
      result.current.replaceSearchParams(new URLSearchParams("seed=portable"));
    });
    expect(window.location.href).toContain("/guess?seed=portable#round");
    expect(callback).toHaveBeenCalledTimes(1);

    render(
      <>
        <DocumentHead>
          <meta name="portable-adapter" content="yes" />
        </DocumentHead>
        <AppLink href="/timeline">Timeline</AppLink>
      </>,
    );
    expect(document.head.querySelector('meta[name="portable-adapter"]')).toHaveAttribute(
      "content",
      "yes",
    );
    expect(screen.getByRole("link", { name: "Timeline" })).toHaveAttribute("href", "/timeline");
  });

  it("provides the complete native browser adapter explicitly", () => {
    const wrapper = ({ children }: React.PropsWithChildren) => (
      <BrowserPlatformProvider
        config={{
          siteOrigin: "https://native.example.com",
          searchDatabaseUrl: "/native-search.sqlite",
          searchEmbeddingsDatabaseUrl: "/native-embeddings.sqlite",
        }}
      >
        {children}
      </BrowserPlatformProvider>
    );
    const { result } = renderHook(
      () => ({
        config: usePublicConfig(),
        components: useClientComponents(),
        navigation: useUrlSearchParams(),
      }),
      { wrapper },
    );

    expect(result.current.config.searchDatabaseUrl).toBe("/native-search.sqlite");
    expect(result.current.navigation.ready).toBe(true);
    expect(Object.keys(result.current.components).sort()).toEqual([
      "GuessMap",
      "Map",
      "MapWorld",
      "PhotoSimilarPhotos",
      "SankeyChart",
      "SearchWithCoi",
      "TripRouteMap",
    ]);
  });

  it("reacts to History API writes made by portable application components", () => {
    window.history.replaceState(null, "", "/map?filter_album=initial");
    const wrapper = ({ children }: React.PropsWithChildren) => (
      <BrowserPlatformProvider>{children}</BrowserPlatformProvider>
    );
    const { result } = renderHook(() => useUrlSearchParams(), { wrapper });

    expect(result.current.getSearchParam("filter_album")).toBe("initial");

    act(() => {
      window.history.replaceState(null, "", "/map?filter_album=replaced");
    });
    expect(result.current.getSearchParam("filter_album")).toBe("replaced");

    act(() => {
      window.history.pushState(null, "", "/map?filter_album=pushed");
    });
    expect(result.current.getSearchParam("filter_album")).toBe("pushed");
  });

  it("reconciles and removes browser-rendered document metadata", () => {
    const view = render(
      <BrowserPlatformProvider>
        <DocumentHead>
          <title>First portable title</title>
          <meta name="portable-route" content="first" />
        </DocumentHead>
      </BrowserPlatformProvider>,
    );

    expect(document.title).toBe("First portable title");
    expect(document.head.querySelectorAll('meta[name="portable-route"]')).toHaveLength(1);

    view.rerender(
      <BrowserPlatformProvider>
        <DocumentHead>
          <title>Second portable title</title>
          <meta name="portable-route" content="second" />
        </DocumentHead>
      </BrowserPlatformProvider>,
    );

    expect(document.title).toBe("Second portable title");
    expect(document.head.querySelector('meta[name="portable-route"]')).toHaveAttribute(
      "content",
      "second",
    );
    expect(document.head.querySelectorAll('meta[name="portable-route"]')).toHaveLength(1);

    view.unmount();
    expect(document.head.querySelector('meta[name="portable-route"]')).toBeNull();
  });
});
