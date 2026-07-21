/**
 * @jest-environment node
 */

import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

jest.mock("next/document", () => {
  const ReactModule = require("react");
  const getInitialProps = jest.fn(async () => ({
    html: "<main />",
    head: [],
    styles: [],
  }));

  class MockDocument extends ReactModule.Component {
    static getInitialProps = getInitialProps;
  }

  return {
    __esModule: true,
    default: MockDocument,
    Html: ({ children, ...props }: React.ComponentProps<"html">) =>
      ReactModule.createElement("html", props, children),
    Head: ({ children }: { children: React.ReactNode }) =>
      ReactModule.createElement("head", null, children),
    Main: () => <main data-next-main="true" />,
    NextScript: () => <script data-next-script="true" />,
    mockGetInitialProps: getInitialProps,
  };
});

import MyDocument from "../../pages/_document";

const { mockGetInitialProps } = jest.requireMock("next/document") as {
  mockGetInitialProps: jest.Mock;
};

describe("custom document", () => {
  it("passes through the framework's initial document properties", async () => {
    const context = { pathname: "/" } as never;

    await expect(MyDocument.getInitialProps(context)).resolves.toEqual({
      html: "<main />",
      head: [],
      styles: [],
    });
    expect(mockGetInitialProps).toHaveBeenCalledWith(context);
  });

  it("renders metadata and the pre-hydration theme initialiser", () => {
    const html = renderToStaticMarkup(<MyDocument />);
    const themeInitialiser = html.indexOf('localStorage.getItem("theme")');
    const headEnd = html.indexOf("</head>");

    expect(html).toContain('<html lang="en-GB">');
    expect(html).toContain('<link rel="manifest" href="/manifest.webmanifest"/>');
    expect(html).toContain(
      '<link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png"/>',
    );
    expect(html).toContain('name="theme-color" content="#000000"');
    expect(html).toContain('localStorage.getItem("darkMode")');
    expect(themeInitialiser).toBeGreaterThan(-1);
    expect(themeInitialiser).toBeLessThan(headEnd);
    expect(html).toContain('data-next-main="true"');
    expect(html).toContain('data-next-script="true"');
  });
});
