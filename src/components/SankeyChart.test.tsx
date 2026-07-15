/**
 * @jest-environment jsdom
 */

import { act, render, screen } from "@testing-library/react";
import { SankeyFlow } from "../util/computeStats";
import { SankeyChart } from "./SankeyChart";

let mockSankeyProps: any = null;
let mockComputedNodes: any[] = [];

jest.mock("@nivo/sankey", () => ({
  ResponsiveSankey: (props: any) => {
    mockSankeyProps = props;
    const customLayer = props.layers.find((layer: unknown) => typeof layer === "function");
    const firstNode = mockComputedNodes[0] ?? {
      id: "fallback",
      label: "Fallback",
      value: 0,
      x0: 0,
      x1: 10,
      y0: 0,
      y1: 20,
    };
    const secondNode = mockComputedNodes[1] ?? firstNode;
    const colours = [
      props.colors({ data: { color: "#111111" } }),
      props.colors({ color: "#222222" }),
      props.colors({}),
    ].join(",");

    return (
      <div data-testid="nivo" data-colours={colours}>
        <svg>{customLayer({ nodes: mockComputedNodes })}</svg>
        <div data-testid="node-tooltip">{props.nodeTooltip({ node: firstNode })}</div>
        <div data-testid="link-tooltip">
          {props.linkTooltip({ link: { source: firstNode, target: secondNode, value: 12 } })}
        </div>
        <div data-testid="value-format">{props.valueFormat(1234)}</div>
      </div>
    );
  },
}));

const flow: SankeyFlow = {
  nodes: [
    {
      id: "root-b",
      label: "Root B",
      count: 5,
      depth: 0,
      facetId: "camera",
      facetValue: "Root B",
    },
    {
      id: "root-a",
      label: "Root A",
      count: 5,
      depth: 0,
      facetId: "camera",
      facetValue: "Root A",
    },
    {
      id: "root-c",
      label: "Root C",
      count: 9,
      depth: 0,
      facetId: "camera",
      facetValue: "Root C",
    },
    {
      id: "middle",
      label: "Middle",
      count: 7,
      depth: 1,
      facetId: "lens",
      facetValue: "Middle",
    },
    {
      id: "leaf",
      label: "Leaf",
      count: 7,
      depth: 4,
      facetId: "city",
      facetValue: "Leaf",
    },
    { id: "orphan", label: "Orphan", count: 1, depth: -1 },
    { id: "external-child", label: "External", count: 1, depth: 2 },
  ],
  links: [
    { source: "root-a", target: "middle", count: 3 },
    { source: "root-b", target: "middle", count: 7 },
    { source: "root-c", target: "middle", count: 7 },
    { source: "middle", target: "leaf", count: 7 },
    { source: "missing-root", target: "external-child", count: 1 },
  ],
};

describe("SankeyChart", () => {
  beforeEach(() => {
    mockSankeyProps = null;
    mockComputedNodes = [];
    document.documentElement.style.removeProperty("--m-s");
    document.documentElement.style.removeProperty("--m-m");
    document.documentElement.style.removeProperty("--size-18");
    delete (globalThis as { ResizeObserver?: unknown }).ResizeObserver;
  });

  it("renders configurable empty states when nodes or links are missing", () => {
    const { rerender } = render(
      <SankeyChart flow={{ nodes: [], links: [] }} emptyMessage="Nothing linked" />,
    );
    expect(screen.getByText("Nothing linked")).toBeTruthy();
    expect(screen.queryByTestId("nivo")).toBeNull();

    rerender(<SankeyChart flow={{ nodes: flow.nodes, links: [] }} />);
    expect(screen.getByText("Not enough linked data yet.")).toBeTruthy();
  });

  it("passes conserved links, inherited colours, sizing, and tooltips to Nivo", () => {
    mockComputedNodes = [
      {
        id: "root-c",
        value: 1234,
        x0: 0,
        x1: 10,
        y0: 0,
        y1: 30,
        data: {
          displayLabel: "A deliberately long root label",
          depth: 0,
          facetId: "camera",
          facetValue: "Root C",
          count: 9,
        },
      },
      {
        id: "leaf",
        x0: 100,
        x1: 110,
        y0: 10,
        y1: 40,
        data: { label: "Leaf", depth: 4, count: 7 },
      },
      {
        id: "short",
        displayLabel: "Short",
        depth: 2,
        facetId: "city",
        x0: 50,
        x1: 60,
        y0: 0,
        y1: 5,
        count: 2,
      },
    ];

    render(<SankeyChart flow={flow} labelMaxLength={18} minHeight={50} minLabelHeight={10} />);

    expect(screen.getByTestId("value-format").textContent).toBe("1,234 photos");
    expect(screen.getByTestId("node-tooltip").textContent).toContain(
      "A deliberately long root label",
    );
    expect(screen.getByTestId("link-tooltip").textContent).toContain(
      "A deliberately long root label to Leaf",
    );
    expect(screen.getByTestId("nivo").getAttribute("data-colours")).toBe("#111111,#222222,#e62065");

    const link = document.querySelector('a[href="/search?facet=camera%3ARoot%20C"]');
    expect(link?.textContent).toBe("A deliberately lo…");
    expect(document.querySelectorAll("svg text")).toHaveLength(2);

    expect(mockSankeyProps.data.links).toContainEqual({
      source: "root-c",
      target: "middle",
      value: 7,
    });
    const colours = new Map(
      mockSankeyProps.data.nodes.map((node: { id: string; color: string }) => [
        node.id,
        node.color,
      ]),
    );
    expect(colours.get("middle")).not.toBe(colours.get("root-a"));
    expect(colours.get("leaf")).toMatch(/^#[0-9a-f]{6}$/);
    expect(colours.get("external-child")).toBe("#e93b77");
    expect(mockSankeyProps.margin.left).toBe(56);
  });

  it("uses direct and fallback node fields for labels, counts, facets, and alignment", () => {
    mockComputedNodes = [
      {
        id: "nested-label",
        x0: 0,
        x1: 10,
        y0: 0,
        y1: 20,
        data: { label: "Nested", depth: 0, facetId: "city", facetValue: "Nested", count: 4 },
      },
      {
        id: "direct-label",
        label: "Direct",
        depth: 2,
        facetId: "city",
        facetValue: "Direct",
        count: 3,
        x0: 100,
        x1: 110,
        y0: 0,
        y1: 20,
      },
      {
        id: "id-only",
        x0: 50,
        x1: 60,
        y0: 0,
        y1: 20,
      },
      {
        id: "no-facet-value",
        x0: 70,
        x1: 80,
        y0: 0,
        y1: 20,
        data: { displayLabel: "No facet value", facetId: "city" },
      },
    ];

    render(<SankeyChart flow={flow} />);

    expect(document.querySelector('a[href="/search?facet=city%3ANested"]')?.textContent).toContain(
      "Nested · 4",
    );
    expect(document.querySelector('a[href="/search?facet=city%3ADirect"]')?.textContent).toContain(
      "Direct · 3",
    );
    expect(screen.getByText("id-only · 0").getAttribute("text-anchor")).toBe("start");
    expect(screen.getByText("Direct · 3").getAttribute("text-anchor")).toBe("end");
    expect(screen.getByText("No facet value · 0").closest("a")?.getAttribute("href")).toBeNull();
  });

  it("uses CSS spacing and clamps margins as the shell resizes", () => {
    document.documentElement.style.setProperty("--m-s", "12px");
    let callback: ResizeObserverCallback | null = null;
    const disconnect = jest.fn();
    const observe = jest.fn();
    class MockResizeObserver {
      constructor(next: ResizeObserverCallback) {
        callback = next;
      }
      observe = observe;
      disconnect = disconnect;
      unobserve = jest.fn();
    }
    globalThis.ResizeObserver = MockResizeObserver as unknown as typeof ResizeObserver;
    const clientWidth = jest
      .spyOn(HTMLElement.prototype, "clientWidth", "get")
      .mockReturnValue(100);

    const { unmount } = render(<SankeyChart flow={flow} />);
    expect(observe).toHaveBeenCalled();
    expect(mockSankeyProps.margin.left).toBe(30);

    act(() => {
      callback?.([{ contentRect: { width: 200 } } as ResizeObserverEntry], {} as ResizeObserver);
    });
    expect(mockSankeyProps.margin.left).toBe(60);

    act(() => {
      callback?.([], {} as ResizeObserver);
    });
    expect(mockSankeyProps.margin.left).toBe(30);

    unmount();
    expect(disconnect).toHaveBeenCalledTimes(1);
    clientWidth.mockRestore();
  });

  it("falls back when the CSS spacing token is not numeric", () => {
    document.documentElement.style.setProperty("--m-s", "invalid");
    render(<SankeyChart flow={flow} />);
    expect(mockSankeyProps.margin.top).toBe(8);
  });

  it("reads label and node geometry from the shared CSS tokens", () => {
    document.documentElement.style.setProperty("--m-m", "16px");
    document.documentElement.style.setProperty("--size-18", "20px");
    mockComputedNodes = [
      {
        id: "root-c",
        value: 9,
        x0: 0,
        x1: 10,
        y0: 0,
        y1: 30,
        data: { label: "Root C", depth: 0, facetId: "camera", facetValue: "Root C" },
      },
    ];

    const { container } = render(<SankeyChart flow={flow} minHeight={0} />);

    expect(screen.getByText("Root C · 9").getAttribute("x")).toBe("26");
    expect(mockSankeyProps.nodeThickness).toBe(20);
    expect(
      container.querySelector<HTMLElement>("[style]")?.style.getPropertyValue("--sankey-height"),
    ).toBe("60px");
  });
});
