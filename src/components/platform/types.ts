import type React from "react";
import type { ClientComponents } from "./clientComponents";

export type AppLinkProps = Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, "href"> & {
  href: string;
};

export type PlatformLink = React.ForwardRefExoticComponent<
  AppLinkProps & React.RefAttributes<HTMLAnchorElement>
>;

export type PlatformHead = React.ComponentType<React.PropsWithChildren>;

export type UrlSearchParams = {
  ready: boolean;
  searchParams: URLSearchParams;
  getSearchParam: (name: string) => string | null;
  hasSearchParam: (name: string) => boolean;
  replaceSearchParams: (params: URLSearchParams) => void;
};

export type PlatformNavigation = UrlSearchParams & {
  subscribeAfterNavigation: (callback: () => void) => () => void;
};

export type PublicConfig = {
  siteOrigin: string;
  searchDatabaseUrl: string;
  searchEmbeddingsDatabaseUrl: string;
};

export type PlatformAdapter = {
  Link: PlatformLink;
  Head: PlatformHead;
  navigation: PlatformNavigation;
  publicConfig: PublicConfig;
  clientComponents: ClientComponents;
};
