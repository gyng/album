/**
 * @jest-environment jsdom
 */

import { act, fireEvent, render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";
import { SearchFacetPanel } from "./SearchFacetPanel";

jest.mock("react-colorful", () => ({
  HexColorPicker: ({ color, onChange }: { color: string; onChange: (value: string) => void }) => (
    <input
      aria-label="Colour palette"
      data-colour={color}
      onChange={(event) => onChange(event.target.value)}
    />
  ),
  HexColorInput: ({
    color,
    onChange,
    prefixed: _prefixed,
    ...props
  }: {
    color: string;
    onChange: (value: string) => void;
    prefixed?: boolean;
  } & Omit<React.InputHTMLAttributes<HTMLInputElement>, "color" | "onChange">) => (
    <input {...props} value={color} onChange={(event) => onChange(event.target.value)} />
  ),
}));

const observe = jest.fn();
const disconnect = jest.fn();
let resizeCallback: ResizeObserverCallback | null = null;

class MockResizeObserver {
  constructor(callback: ResizeObserverCallback) {
    resizeCallback = callback;
  }

  observe = observe;
  disconnect = disconnect;
}

const handlers = {
  onSelectCategory: jest.fn(),
  onClearColorSearch: jest.fn(),
  onSetColorSearch: jest.fn(),
  onSetColorTolerance: jest.fn(),
  onToggleFacet: jest.fn(),
  onToggleTag: jest.fn(),
};

const baseProps = (): ComponentProps<typeof SearchFacetPanel> => ({
  sections: [],
  selectedCategory: "tags",
  colorSearch: null,
  colorTolerance: 25,
  selectedFacets: [],
  normalizedSearchTerms: [],
  normalizedTags: [],
  refinementCounts: {},
  tagCountsAreExact: true,
  isLoading: false,
  ...handlers,
});

describe("SearchFacetPanel", () => {
  beforeAll(() => {
    globalThis.ResizeObserver = MockResizeObserver as unknown as typeof ResizeObserver;
  });

  beforeEach(() => {
    jest.clearAllMocks();
    resizeCallback = null;
  });

  it("supports click and wrapping arrow-key navigation between category tabs", () => {
    render(<SearchFacetPanel {...baseProps()} />);
    const tags = screen.getByRole("tab", { name: "Tags" });
    const colour = screen.getByRole("tab", { name: "Colour" });
    const settings = screen.getByRole("tab", { name: "Settings" });

    fireEvent.keyDown(tags, { key: "Enter" });
    expect(handlers.onSelectCategory).not.toHaveBeenCalled();

    fireEvent.keyDown(tags, { key: "ArrowRight" });
    expect(handlers.onSelectCategory).toHaveBeenLastCalledWith("color");
    expect(colour).toHaveFocus();

    fireEvent.keyDown(tags, { key: "ArrowLeft" });
    expect(handlers.onSelectCategory).toHaveBeenLastCalledWith("settings");
    expect(settings).toHaveFocus();

    fireEvent.click(screen.getByRole("tab", { name: "Time" }));
    expect(handlers.onSelectCategory).toHaveBeenLastCalledWith("time");
  });

  it("tracks overflow above and below, observes resizes, and cleans up", () => {
    const view = render(<SearchFacetPanel {...baseProps()} />);
    const content = screen.getByRole("tabpanel");
    expect(observe).toHaveBeenCalledWith(content);

    Object.defineProperties(content, {
      scrollTop: { configurable: true, value: 10, writable: true },
      scrollHeight: { configurable: true, value: 100 },
      clientHeight: { configurable: true, value: 50 },
    });
    fireEvent.scroll(content);

    Object.defineProperty(content, "scrollTop", { configurable: true, value: 50, writable: true });
    act(() => resizeCallback?.([], {} as ResizeObserver));

    view.unmount();
    expect(disconnect).toHaveBeenCalled();
    act(() => resizeCallback?.([], {} as ResizeObserver));
  });

  it("shows tag refinement counts and preserves active tag behaviour", () => {
    const props = baseProps();
    const view = render(
      <SearchFacetPanel
        {...props}
        normalizedTags={[
          { name: "Active", count: 8 },
          { name: "Refined", count: 12 },
          { name: "Blocked", count: 4 },
          { name: "Plain", count: 6 },
        ]}
        normalizedSearchTerms={["Active"]}
        refinementCounts={{ Active: 0, Refined: 3, Blocked: 0 }}
      />,
    );

    const active = screen.getByText("active").closest("button")!;
    const refined = screen.getByText("refined").closest("button")!;
    const blocked = screen.getByText("blocked").closest("button")!;
    expect(active).toHaveTextContent("8");
    expect(active).toHaveAttribute("aria-pressed", "true");
    expect(active).toBeEnabled();
    expect(refined).toHaveTextContent("3");
    expect(blocked).toBeDisabled();
    expect(screen.getByText("plain").closest("button")).toHaveTextContent("6");

    fireEvent.click(active);
    fireEvent.click(refined);
    expect(handlers.onToggleTag).toHaveBeenNthCalledWith(1, "Active", true);
    expect(handlers.onToggleTag).toHaveBeenNthCalledWith(2, "Refined", false);

    view.rerender(
      <SearchFacetPanel
        {...props}
        normalizedTags={[{ name: "Legacy", count: 6 }]}
        tagCountsAreExact={false}
      />,
    );
    expect(screen.getByText("legacy").closest("button")).toHaveTextContent("5");
  });

  it("edits, clears, and resets the colour filter", () => {
    const props = baseProps();
    const view = render(<SearchFacetPanel {...props} selectedCategory="color" />);
    expect(screen.getByRole("button", { name: "Clear" })).toBeDisabled();
    expect(screen.getByText("#ff6b6b")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Colour palette"), { target: { value: "#abc" } });
    expect(handlers.onSetColorSearch).toHaveBeenLastCalledWith([170, 187, 204]);
    fireEvent.change(screen.getByLabelText("Colour palette"), { target: { value: "invalid" } });
    expect(handlers.onSetColorSearch).toHaveBeenCalledTimes(1);

    fireEvent.change(screen.getByLabelText("Colour distance tolerance"), {
      target: { value: "40" },
    });
    expect(handlers.onSetColorTolerance).toHaveBeenCalledWith(40);

    view.rerender(<SearchFacetPanel {...props} selectedCategory="color" colorSearch={[1, 2, 3]} />);
    expect(screen.getByText("#010203")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Current colour swatch"), {
      target: { value: "#112233" },
    });
    fireEvent.change(screen.getByLabelText("Colour filter hex value"), {
      target: { value: "#445566" },
    });
    expect(handlers.onSetColorSearch).toHaveBeenNthCalledWith(2, [17, 34, 51]);
    expect(handlers.onSetColorSearch).toHaveBeenNthCalledWith(3, [68, 85, 102]);
    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    expect(handlers.onClearColorSearch).toHaveBeenCalled();
  });

  it("renders only the selected facet sections and applies facet availability rules", () => {
    const props = baseProps();
    const sections = [
      {
        facetId: "year",
        displayName: "Year",
        options: [
          { value: "2024", count: 0 },
          { value: "2023", count: 0 },
        ],
      },
      {
        facetId: "hour",
        displayName: "Hour",
        options: [{ value: "Morning", count: 2 }],
      },
      {
        facetId: "city",
        displayName: "City",
        options: [{ value: "Tokyo", count: 0 }],
      },
    ];
    const view = render(
      <SearchFacetPanel
        {...props}
        sections={sections}
        selectedCategory="time"
        selectedFacets={[{ facetId: "year", value: "2023" }]}
      />,
    );
    expect(screen.getByRole("heading", { name: "Year" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Hour" })).toBeInTheDocument();
    expect(screen.queryByText("Tokyo")).toBeNull();
    expect(screen.getByText("2024").closest("button")).toBeDisabled();
    expect(screen.getByText("2023").closest("button")).toBeEnabled();
    fireEvent.click(screen.getByText("2023").closest("button")!);
    expect(handlers.onToggleFacet).toHaveBeenCalledWith({ facetId: "year", value: "2023" });

    view.rerender(<SearchFacetPanel {...props} sections={sections} selectedCategory="place" />);
    expect(screen.getByText("Tokyo").closest("button")).toBeEnabled();
    expect(screen.queryByRole("heading", { name: "City" })).toBeNull();
  });

  it("shows loading status instead of tag or facet options", () => {
    render(
      <SearchFacetPanel
        {...baseProps()}
        isLoading
        normalizedTags={[{ name: "Hidden", count: 1 }]}
      />,
    );
    expect(screen.getByText("Loading filters…")).toBeInTheDocument();
    expect(screen.queryByText("hidden")).toBeNull();
  });
});
