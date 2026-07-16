import React from "react";
import { createPortal } from "react-dom";
import { browserClientComponents } from "../browserClientComponents";
import { useBrowserNavigation } from "../browserNavigation";
import { PlatformProvider } from "../context";
import { publicConfig } from "../publicConfig";
import type { PlatformAdapter } from "../types";

const BrowserLink = React.forwardRef<HTMLAnchorElement, React.ComponentProps<"a">>(
  function BrowserLink({ children, ...props }, ref) {
    return (
      <a {...props} ref={ref}>
        {children}
      </a>
    );
  },
);

const BrowserHead = ({ children }: React.PropsWithChildren) =>
  typeof document === "undefined" ? null : createPortal(children, document.head);

export const BrowserPlatformProvider = ({
  children,
  config = publicConfig,
}: React.PropsWithChildren<{ config?: PlatformAdapter["publicConfig"] }>) => {
  const navigation = useBrowserNavigation();
  const adapter = React.useMemo<PlatformAdapter>(
    () => ({
      Link: BrowserLink,
      Head: BrowserHead,
      navigation,
      publicConfig: config,
      clientComponents: browserClientComponents,
    }),
    [config, navigation],
  );
  return <PlatformProvider value={adapter}>{children}</PlatformProvider>;
};
