/**
 * @jest-environment jsdom
 */

import { fireEvent, screen } from "@testing-library/react";
import { renderWithNextPlatform as render } from "../../renderWithNextPlatform";

const push = jest.fn();
const replace = jest.fn();
let mockQuery: Record<string, string> = {};
let mockRouterReady = true;

jest.mock("../../../services/album", () => ({
  getAlbums: jest.fn(),
}));

jest.mock("next/router", () => ({
  useRouter: () => ({
    query: mockQuery,
    isReady: mockRouterReady,
    push,
    replace,
  }),
}));

jest.mock("next/head", () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

jest.mock("next/link", () => ({
  __esModule: true,
  default: ({
    href,
    children,
    onClick,
    ...props
  }: {
    href: string;
    children: React.ReactNode;
    onClick?: React.MouseEventHandler<HTMLAnchorElement>;
  }) => (
    <a
      {...props}
      href={href}
      data-next-link="true"
      onClick={(event) => {
        onClick?.(event);

        if (!event.defaultPrevented) {
          event.preventDefault();
          push(href);
        }
      }}
    >
      {children}
    </a>
  ),
}));

jest.mock("../../../components/MapWorldDeferred", () => ({
  MapWorldDeferred: ({ className }: { className: string }) => (
    <div data-testid="map-world" className={className} />
  ),
}));

const { default: WorldMap } = require("../../../screens/map/MapScreen");

describe("WorldMap page", () => {
  beforeEach(() => {
    mockQuery = {};
    mockRouterReady = true;
    push.mockClear();
    replace.mockClear();
  });

  it("uses client-side navigation for the albums link", () => {
    render(<WorldMap photos={[]} />);

    fireEvent.click(screen.getByRole("link", { name: "Albums" }));

    expect(push).toHaveBeenCalledWith("/");
  });

  it("uses client-side navigation for the filtered album link", () => {
    mockQuery = { filter_album: "kansai" };

    render(<WorldMap photos={[]} />);

    fireEvent.click(screen.getByRole("link", { name: "kansai" }));

    expect(push).toHaveBeenCalledWith("/album/kansai");
    expect(document.head.querySelector('meta[name="robots"]')).toHaveAttribute(
      "content",
      "noindex, nofollow",
    );
  });

  it("waits for URL state before rendering an album filter", () => {
    mockQuery = { filter_album: "kansai" };
    mockRouterReady = false;

    const { rerender } = render(<WorldMap photos={[]} />);

    expect(screen.queryByRole("link", { name: "kansai" })).not.toBeInTheDocument();

    mockRouterReady = true;
    rerender(<WorldMap photos={[]} />);

    expect(screen.getByRole("link", { name: "kansai" })).toBeInTheDocument();
  });
});
