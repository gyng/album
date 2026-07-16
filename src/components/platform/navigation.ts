import React from "react";
import { useBrowserNavigation } from "./browserNavigation";
import { usePlatformAdapter } from "./context";
import type { PlatformNavigation, UrlSearchParams } from "./types";

/**
 * Reactive query state expressed with URLSearchParams rather than a framework
 * router. Replacements retain client-side navigation and avoid a page reload.
 */
export const useUrlSearchParams = (): UrlSearchParams => {
  const navigation = useNavigation();
  return navigation;
};

/** Runs a callback after navigation within the current client application. */
export const useAfterNavigation = (callback: () => void): void => {
  const navigation = useNavigation();
  const subscribeAfterNavigation = navigation.subscribeAfterNavigation;
  React.useEffect(() => {
    return subscribeAfterNavigation(callback);
  }, [callback, subscribeAfterNavigation]);
};

const useNavigation = (): PlatformNavigation => {
  const platform = usePlatformAdapter();
  const browserNavigation = useBrowserNavigation(platform === null);
  return platform?.navigation ?? browserNavigation;
};
