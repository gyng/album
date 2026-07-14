/**
 * @jest-environment jsdom
 */

import { fireEvent, render, screen } from "@testing-library/react";
import type { NumericFacetStat, ParallelRelationshipData } from "../util/computeStats";
import { TimeRelationshipExplorer } from "./TimeRelationshipExplorer";

const chartProps = jest.fn();
jest.mock("./TimeOfDayChart", () => ({
  TimeOfDayChart: (props: {
    activeLabel: string | null;
    onActivate: (label: string) => void;
    onDeactivate: () => void;
  }) => {
    chartProps(props);
    return (
      <button
        type="button"
        onMouseEnter={() => props.onActivate("08:00")}
        onMouseLeave={props.onDeactivate}
      >
        Time chart
      </button>
    );
  },
}));

const heatmapProps = jest.fn();
jest.mock("./TechnicalHeatmaps", () => ({
  TechnicalHeatmaps: (props: { activeXAxisBucket: string | null }) => {
    heatmapProps(props);
    return <div data-testid="heatmaps">{props.activeXAxisBucket ?? "none"}</div>;
  },
}));

const relationships: ParallelRelationshipData = {
  axes: [
    { facetId: "hour", label: "Hour", buckets: ["08:00"] },
    { facetId: "aperture", label: "Aperture", buckets: ["f/2"] },
    { facetId: "iso", label: "ISO", buckets: ["100"] },
  ],
  paths: [{ values: ["08:00", "f/2", "100"], count: 1_234 }],
  total: 1_234,
};

const hourFacet = (coverage: number): NumericFacetStat => ({
  facetId: "hour",
  displayName: "Time of day",
  data: [{ label: "08:00", count: 1_234 }],
  coverage,
});

describe("TimeRelationshipExplorer", () => {
  beforeEach(() => {
    chartProps.mockClear();
    heatmapProps.mockClear();
  });

  it("shares the active hour between the overview and heatmaps", () => {
    render(
      <TimeRelationshipExplorer
        hourFacet={hourFacet(0.8)}
        relationships={relationships}
        formatCoverage={(coverage) => `${coverage * 100}% covered`}
      />,
    );

    expect(screen.getByText("80% covered")).toBeInTheDocument();
    expect(screen.getByText(/Based on 1,234 photos/)).toBeInTheDocument();
    expect(screen.getByTestId("heatmaps")).toHaveTextContent("none");
    expect(heatmapProps).toHaveBeenLastCalledWith(
      expect.objectContaining({
        pairs: [
          [0, 1],
          [0, 2],
        ],
        layout: "two-up",
        activeXAxisBucket: null,
      }),
    );

    fireEvent.mouseEnter(screen.getByRole("button", { name: "Time chart" }));
    expect(screen.getByTestId("heatmaps")).toHaveTextContent("08:00");
    fireEvent.mouseLeave(screen.getByRole("button", { name: "Time chart" }));
    expect(screen.getByTestId("heatmaps")).toHaveTextContent("none");
  });

  it("explains missing hour data while retaining the relationship summary", () => {
    render(
      <TimeRelationshipExplorer
        hourFacet={hourFacet(0)}
        relationships={{ ...relationships, total: 0 }}
        formatCoverage={() => "No coverage"}
      />,
    );

    expect(screen.getByText("No data available.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Time chart" })).toBeNull();
    expect(screen.getByText(/Based on 0 photos/)).toBeInTheDocument();
  });
});
