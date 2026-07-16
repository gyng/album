import React from "react";
import { usePlatformRenderers } from "./context";

/** Framework adapter for content rendered into the document head. */
export const DocumentHead: React.FC<React.PropsWithChildren> = ({ children }) => {
  const { Head } = usePlatformRenderers();
  return <Head>{children}</Head>;
};
