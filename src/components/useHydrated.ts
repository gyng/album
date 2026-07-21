import React from "react";

const subscribe = () => () => {};
const getClientSnapshot = () => true;
const getServerSnapshot = () => false;

/** Returns false for SSR and the matching hydration render, then true. */
export const useHydrated = (): boolean =>
  React.useSyncExternalStore(subscribe, getClientSnapshot, getServerSnapshot);
