import React from "react";
import { usePlatformRenderers } from "./context";
import type { AppLinkProps } from "./types";

export type { AppLinkProps } from "./types";

/**
 * Internal navigation with an ordinary anchor-shaped contract.
 *
 * Application components deliberately do not receive Next-specific routing
 * props; a different renderer only needs to replace this adapter.
 */
export const AppLink = React.forwardRef<HTMLAnchorElement, AppLinkProps>(
  function AppLink(props, ref) {
    const { Link } = usePlatformRenderers();
    return <Link {...props} ref={ref} />;
  },
);
