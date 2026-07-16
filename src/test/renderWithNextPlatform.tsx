import {
  render as testingLibraryRender,
  type RenderOptions,
  type RenderResult,
} from "@testing-library/react";
import type React from "react";
import { NextPlatformProvider } from "../components/platform/next/NextPlatformProvider";

export const renderWithNextPlatform = (
  ui: React.ReactNode,
  options?: Omit<RenderOptions, "wrapper">,
): RenderResult =>
  testingLibraryRender(ui, {
    ...options,
    wrapper: ({ children }) => <NextPlatformProvider>{children}</NextPlatformProvider>,
  });
