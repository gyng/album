/**
 * @jest-environment jsdom
 */

import { render, screen } from "@testing-library/react";

const mockUseDatabase = jest.fn();

jest.mock("../../../components/database/useDatabase", () => ({
  useDatabase: () => mockUseDatabase(),
}));

jest.mock("../../../components/ProgressBar", () => ({
  ProgressBar: ({ progress }: { progress: number }) => (
    <div>Loading... {progress}%</div>
  ),
}));

jest.mock("../../../components/ThemeToggle", () => ({
  ThemeToggle: () => <div>Theme toggle</div>,
}));

jest.mock("../../../components/Map", () => () => null);

jest.mock("next/link", () => ({
  __esModule: true,
  default: ({ children, href }: any) => <a href={href}>{children}</a>,
}));

jest.mock("next/head", () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => children,
}));

jest.mock("usehooks-ts", () => ({
  useLocalStorage: (_key: string, initialValue: unknown) => [
    initialValue,
    jest.fn(),
    jest.fn(),
  ],
}));

const SlideshowPage =
  require("../../../pages/slideshow/index").default;

describe("slideshow page", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseDatabase.mockReturnValue([null, 42]);
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      text: async () => "",
    }) as jest.Mock;
  });

  it("renders loading progress while the database is unavailable", () => {
    render(<SlideshowPage />);

    expect(screen.getByText("Loading... 42%")).toBeTruthy();
  });
});
