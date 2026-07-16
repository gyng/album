import React from "react";
import { createPortal } from "react-dom";
import { publicConfig as defaultPublicConfig } from "./publicConfig";
import type { PlatformAdapter, PlatformHead, PlatformLink } from "./types";

const NativeLink: PlatformLink = React.forwardRef<HTMLAnchorElement, React.ComponentProps<"a">>(
  function NativeLink({ children, ...props }, ref) {
    return (
      <a {...props} ref={ref}>
        {children}
      </a>
    );
  },
);

const NativeHead: PlatformHead = ({ children }) =>
  typeof document === "undefined" ? null : createPortal(children, document.head);

export const PlatformContext = React.createContext<PlatformAdapter | null>(null);

export const PlatformProvider = PlatformContext.Provider;

export const usePlatformRenderers = (): Pick<PlatformAdapter, "Link" | "Head"> => {
  const platform = React.useContext(PlatformContext);
  return platform ?? { Link: NativeLink, Head: NativeHead };
};

export const usePlatformAdapter = (): PlatformAdapter | null => React.useContext(PlatformContext);

export const usePublicConfig = () =>
  React.useContext(PlatformContext)?.publicConfig ?? defaultPublicConfig;

export const useClientComponents = () => {
  const clientComponents = React.useContext(PlatformContext)?.clientComponents;
  if (!clientComponents) {
    throw new Error("Client components require a renderer PlatformProvider");
  }
  return clientComponents;
};
