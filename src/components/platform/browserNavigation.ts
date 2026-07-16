import React from "react";
import type { PlatformNavigation } from "./types";

const NAVIGATION_EVENT = "snapshots:navigation";
const HISTORY_OBSERVER = Symbol.for("snapshots.history-observer");
const SERVER_HREF = "/";
const subscribeDisabled = () => () => {};
const disabledHref = () => SERVER_HREF;

const browserHref = (): string =>
  typeof window === "undefined"
    ? SERVER_HREF
    : `${window.location.pathname}${window.location.search}${window.location.hash}`;

type ObservedHistory = History & { [HISTORY_OBSERVER]?: boolean };

const observeHistoryWrites = (): void => {
  if (typeof window === "undefined") return;
  const history = window.history as ObservedHistory;
  if (history[HISTORY_OBSERVER]) return;

  const originalPushState = history.pushState.bind(history);
  const originalReplaceState = history.replaceState.bind(history);
  const notify = () => window.dispatchEvent(new Event(NAVIGATION_EVENT));

  history.pushState = function pushState(
    this: History,
    data: unknown,
    unused: string,
    url?: string | URL | null,
  ) {
    originalPushState(data, unused, url);
    notify();
  };
  history.replaceState = function replaceState(
    this: History,
    data: unknown,
    unused: string,
    url?: string | URL | null,
  ) {
    originalReplaceState(data, unused, url);
    notify();
  };
  Object.defineProperty(history, HISTORY_OBSERVER, { value: true });
};

const subscribe = (callback: () => void): (() => void) => {
  if (typeof window === "undefined") return () => {};
  // Portable components and third-party routers may use the standard History
  // API directly. Browsers do not emit popstate for pushState/replaceState, so
  // bridge those writes into the same reactive navigation signal.
  observeHistoryWrites();
  window.addEventListener("popstate", callback);
  window.addEventListener(NAVIGATION_EVENT, callback);
  return () => {
    window.removeEventListener("popstate", callback);
    window.removeEventListener(NAVIGATION_EVENT, callback);
  };
};

export const useBrowserNavigation = (enabled = true): PlatformNavigation => {
  const href = React.useSyncExternalStore(
    enabled ? subscribe : subscribeDisabled,
    enabled ? browserHref : disabledHref,
    disabledHref,
  );
  const url = React.useMemo(() => new URL(href, "http://snapshots.invalid"), [href]);
  const searchParams = React.useMemo(() => new URLSearchParams(url.search), [url.search]);
  const getSearchParam = React.useCallback(
    (name: string) => {
      const values = searchParams.getAll(name);
      return values.length === 1 ? values[0] : null;
    },
    [searchParams],
  );
  const hasSearchParam = React.useCallback(
    (name: string) => searchParams.has(name),
    [searchParams],
  );
  const replaceSearchParams = React.useCallback(
    (next: URLSearchParams) => {
      if (typeof window === "undefined") return;
      const query = next.toString();
      const nextHref = `${url.pathname}${query ? `?${query}` : ""}${url.hash}`;
      window.history.replaceState(window.history.state, "", nextHref);
    },
    [url.hash, url.pathname],
  );

  return {
    ready: enabled && typeof window !== "undefined",
    searchParams,
    getSearchParam,
    hasSearchParam,
    replaceSearchParams,
    subscribeAfterNavigation: subscribe,
  };
};
