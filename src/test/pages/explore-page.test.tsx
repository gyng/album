/**
 * @jest-environment jsdom
 */

import { fireEvent, render, screen } from "@testing-library/react";

jest.mock("../../services/album", () => ({ getAlbums: jest.fn() }));
jest.mock("../../services/buildTiming", () => ({
  measureBuild: (_name: string, work: () => unknown) => work(),
}));
jest.mock("../../util/computeStats", () => ({ computePhotoStats: jest.fn() }));
jest.mock("../../util/computeEmbeddingStats", () => ({
  computeVisualSamenessStats: jest.fn(),
}));
jest.mock("../../util/searchFacets", () => ({
  buildSearchFacetHref: ({ facetId, value }: { facetId: string; value: string }) =>
    `/search?${facetId}=${value}`,
  isSearchableFacetId: (facetId: string) => facetId !== "iso" && facetId !== "lens",
}));
jest.mock("../../components/explore/exploreViewModel", () => ({
  buildExploreFunStats: () => [],
  buildExploreOverviewCards: () => [],
  EXPLORE_SECTION_LINKS: [],
  findNumericFacet: (stats: { numericFacets: Array<{ facetId: string }> }, id: string) =>
    stats.numericFacets.find((facet) => facet.facetId === id) ?? null,
  findStringFacet: (stats: { stringFacets: Array<{ facetId: string }> }, id: string) =>
    stats.stringFacets.find((facet) => facet.facetId === id) ?? null,
  formatCoverage: (coverage: number) => `${coverage * 100}% covered`,
  isAggregateLocationBucket: (label: string) => label === "Unknown",
}));

jest.mock("../../components/GlobalNav", () => ({ GlobalNav: () => <nav /> }));
jest.mock("../../components/Seo", () => ({ Seo: () => null }));
jest.mock("../../components/MiniHistogram", () => ({
  MiniHistogram: ({ title }: { title: string }) => <div>{title}</div>,
}));
jest.mock("../../components/SankeyChartDeferred", () => ({
  SankeyChartDeferred: ({ emptyMessage }: { emptyMessage?: string }) => (
    <div data-testid="sankey">{emptyMessage}</div>
  ),
}));
jest.mock("../../components/StatBar", () => ({
  StatBar: ({ label, actionHref }: { label: string; actionHref: string | null }) => (
    <div data-testid={`bar-${label}`} data-href={actionHref ?? "none"} />
  ),
}));
jest.mock("../../components/StatsWorldMap", () => ({
  StatsWorldMap: () => <div data-testid="world-map" />,
}));
jest.mock("../../components/TechnicalHeatmaps", () => ({
  TechnicalHeatmaps: ({ data }: { data: { total: number } }) => (
    <div data-testid="heatmaps">{data.total}</div>
  ),
}));
jest.mock("../../components/TimeRelationshipExplorer", () => ({
  TimeRelationshipExplorer: ({ relationships }: { relationships: { total: number } }) => (
    <div data-testid="time-relationships">{relationships.total}</div>
  ),
}));
jest.mock("../../components/explore/ExploreOverview", () => ({
  ExploreOverview: () => <div />,
}));
jest.mock("../../components/explore/ExploreStorySections", () => ({
  ExploreFunStatsSection: () => <section />,
  ExploreRecentTrendsSection: () => <section />,
  ExploreRevisitedPlacesSection: () => <section />,
}));
jest.mock("../../components/explore/ExploreColourSection", () => ({
  ExploreColourSection: () => <section />,
}));
jest.mock("../../components/explore/ExplorePrimitives", () => ({
  ExploreStatGroup: ({
    title,
    children,
    actions,
  }: React.PropsWithChildren<{ title: string; actions?: React.ReactNode }>) => (
    <section aria-label={title}>
      {actions}
      {children}
    </section>
  ),
  ExploreStatSection: ({ title, children }: React.PropsWithChildren<{ title: string }>) => (
    <section aria-label={title}>{children}</section>
  ),
  VisualSimilarityThumb: ({ photo }: { photo: { label: string } }) => <span>{photo.label}</span>,
}));
jest.mock("../../components/ui", () => ({
  Footer: () => <footer />,
  Card: ({ children }: React.PropsWithChildren) => <article>{children}</article>,
  Caption: ({ children }: React.PropsWithChildren) => <span>{children}</span>,
  Heading: ({ children }: React.PropsWithChildren) => <h2>{children}</h2>,
  PillButton: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button {...props}>{children}</button>
  ),
  SegmentedToggle: ({
    options,
    onChange,
    ariaLabel,
  }: {
    options: Array<{ value: string; label: string }>;
    onChange: (value: string) => void;
    ariaLabel: string;
  }) => (
    <div aria-label={ariaLabel}>
      {options.map((option) => (
        <button key={option.value} onClick={() => onChange(option.value)}>
          {option.label}
        </button>
      ))}
    </div>
  ),
  Select: (props: React.SelectHTMLAttributes<HTMLSelectElement>) => <select {...props} />,
  pillStyles: { base: "base", ghost: "ghost" },
}));

import ExplorePage, { getStaticProps } from "../../pages/explore";

const { getAlbums } = jest.requireMock("../../services/album") as { getAlbums: jest.Mock };
const { computePhotoStats } = jest.requireMock("../../util/computeStats") as {
  computePhotoStats: jest.Mock;
};
const { computeVisualSamenessStats } = jest.requireMock("../../util/computeEmbeddingStats") as {
  computeVisualSamenessStats: jest.Mock;
};

const numeric = (facetId: string, data = [{ label: "Known", count: 2 }], coverage = 1) => ({
  facetId,
  displayName: facetId,
  data,
  coverage,
});
const stringFacet = (facetId: string, data = [{ label: `${facetId} value`, count: 2 }]) => ({
  facetId,
  displayName: facetId,
  data,
  coverage: 1,
});
const relationship = (total: number) => ({ total });
const scope = (total: number) => ({
  numericFacets: [
    numeric("hour"),
    numeric("focal-length-35mm"),
    numeric("focal-length-actual"),
    numeric("aperture"),
    numeric("iso"),
  ],
  weekdayStats: [],
  monthStats: [],
  calendarCoverage: 1,
  timeRelationships: relationship(total),
  technicalRelationships: relationship(total),
});

const makeStats = () => ({
  numericFacets: [
    numeric("hour", [
      { label: "Known", count: 2 },
      { label: "Unknown", count: 0 },
    ]),
    numeric("focal-length-35mm"),
    numeric("focal-length-actual", [], 0),
    numeric("aperture"),
    numeric("iso"),
  ],
  stringFacets: [
    stringFacet("location"),
    stringFacet("region"),
    stringFacet("subregion"),
    stringFacet("city", []),
    stringFacet("camera"),
    stringFacet("lens"),
  ],
  technicalRelationshipFilters: {
    cameras: ["Cam 1", "Cam 2", "Cam 3"],
    lenses: ["Lens 1", "Lens X"],
    lensesByCamera: { "Cam 1": ["Lens 1"], "Cam 2": ["Lens 2"] },
    byCameraLens: { "Cam 1": { "Lens 1": scope(11) } },
    byCamera: {
      "Cam 1": scope(12),
      "Cam 2": { ...scope(14), technicalRelationships: null },
    },
    byLens: { "Lens 1": scope(13) },
  },
  timeRelationships: relationship(1),
  technicalRelationships: relationship(2),
  weekdayStats: [],
  monthStats: [],
  calendarCoverage: 1,
  recentYearStats: [],
  revisitedPlaces: [],
  mapPoints: [],
  locationFlow: {
    nodes: [
      { id: "one", label: "Raw", displayLabel: "Shown", facetValue: "value", count: 3, depth: 0 },
      { id: "equal", label: "Equal", count: 3, depth: 0 },
      { id: "lower", label: "Lower", count: 1, depth: 0 },
      { id: "two", label: "Fallback", count: 2, depth: 1 },
    ],
    links: [],
  },
  gearFlow: { nodes: [], links: [] },
});

const photo = (id: string) => ({ path: id, src: `/${id}`, href: `/album/${id}`, label: id });
const makeVisualSameness = () => ({
  sampleSize: 10,
  samenessPercent: 70,
  repeatedMotifPercent: 20,
  distinctPercent: 10,
  averageNearestSimilarity: 0.7,
  highSimilarityThreshold: 0.9,
  lowSimilarityThreshold: 0.2,
  lookDrift: { similarityPercent: 60, firstYear: 2020, lastYear: 2026 },
  averageExamples: Array.from({ length: 5 }, (_, index) => ({
    photo: photo(`average-${index}`),
    centroidSimilarityPercent: 70,
  })),
  distinctExamples: Array.from({ length: 5 }, (_, index) => ({
    photo: photo(`distinct-${index}`),
    nearestSimilarityPercent: 20,
  })),
  repeatedExamples: Array.from({ length: 3 }, (_, index) => ({
    left: photo(`left-${index}`),
    right: photo(`right-${index}`),
    similarityPercent: 95,
  })),
  visualEras: Array.from({ length: 5 }, (_, index) => ({
    label: `Era ${index}`,
    photos: [photo(`era-${index}`)],
    sharePercent: 20,
    count: 2,
  })),
  lookTimeline: Array.from({ length: 5 }, (_, index) => ({
    year: 2020 + index,
    photos: [photo(`year-${index}`)],
    count: 2,
  })),
});

describe("explore page", () => {
  it("switches charts, scopes technical data, and expands visual examples", () => {
    render(<ExplorePage stats={makeStats() as never} visualSameness={makeVisualSameness()} />);

    fireEvent.click(screen.getByRole("button", { name: "Load more average photos" }));
    fireEvent.click(screen.getByRole("button", { name: "Load more distinct frames" }));
    fireEvent.click(screen.getByRole("button", { name: "Load more repeated motifs" }));
    fireEvent.click(screen.getByRole("button", { name: "Load more recurring looks" }));
    fireEvent.click(screen.getByRole("button", { name: "Load more years" }));
    expect(screen.queryByRole("button", { name: "Load more years" })).not.toBeInTheDocument();

    const locationControls = screen.getByLabelText("Location chart view");
    fireEvent.click(locationControls.querySelectorAll("button")[1]);
    expect(screen.getAllByTestId("sankey").length).toBeGreaterThan(1);
    fireEvent.click(locationControls.querySelectorAll("button")[2]);

    const gearControls = screen.getByLabelText("Gear chart view");
    fireEvent.click(gearControls.querySelectorAll("button")[1]);

    const selects = screen.getAllByRole("combobox");
    fireEvent.change(selects[0], { target: { value: "Cam 1" } });
    fireEvent.change(selects[1], { target: { value: "Lens 1" } });
    expect(screen.getAllByTestId("heatmaps").at(-1)).toHaveTextContent("11");
    fireEvent.change(selects[0], { target: { value: "all" } });
    expect(screen.getAllByTestId("heatmaps").at(-1)).toHaveTextContent("13");
    fireEvent.change(selects[1], { target: { value: "Lens X" } });
    fireEvent.change(selects[0], { target: { value: "Cam 2" } });
    fireEvent.change(selects[1], { target: { value: "Lens 2" } });
    fireEvent.change(selects[1], { target: { value: "all" } });
    fireEvent.change(selects[0], { target: { value: "Cam 3" } });
  });

  it("omits unavailable visual and cadence sections", () => {
    const stats = makeStats();
    stats.calendarCoverage = 0;
    stats.timeRelationships = null as never;
    stats.technicalRelationships = null as never;
    render(<ExplorePage stats={stats as never} visualSameness={null} />);

    expect(screen.queryByRole("heading", { name: "Visual sameness" })).not.toBeInTheDocument();
    expect(screen.queryByText("Archive cadence")).not.toBeInTheDocument();
  });

  it("handles each sparse visual-similarity collection independently", () => {
    const empty = {
      ...makeVisualSameness(),
      lookDrift: null,
      averageExamples: [],
      distinctExamples: [],
      repeatedExamples: [],
      visualEras: [],
      lookTimeline: [],
    };
    const { rerender } = render(
      <ExplorePage stats={makeStats() as never} visualSameness={empty} />,
    );
    expect(screen.queryByText("Most average photos")).not.toBeInTheDocument();

    rerender(
      <ExplorePage
        stats={makeStats() as never}
        visualSameness={{
          ...empty,
          repeatedExamples: makeVisualSameness().repeatedExamples.slice(0, 1),
        }}
      />,
    );
    rerender(
      <ExplorePage
        stats={makeStats() as never}
        visualSameness={{
          ...empty,
          distinctExamples: makeVisualSameness().distinctExamples.slice(0, 1),
        }}
      />,
    );
    rerender(
      <ExplorePage
        stats={makeStats() as never}
        visualSameness={{ ...empty, visualEras: makeVisualSameness().visualEras.slice(0, 1) }}
      />,
    );
    rerender(
      <ExplorePage
        stats={makeStats() as never}
        visualSameness={{
          ...empty,
          lookTimeline: makeVisualSameness().lookTimeline.slice(0, 1),
        }}
      />,
    );
    expect(screen.getByText("Yearly representative sets")).toBeInTheDocument();
  });

  it("loads build-time stats and degrades gracefully when visual stats fail", async () => {
    const albums = [{ name: "trip" }];
    const stats = makeStats();
    getAlbums.mockResolvedValue(albums);
    computePhotoStats.mockReturnValue(stats);
    computeVisualSamenessStats.mockResolvedValueOnce(makeVisualSameness());

    await expect(getStaticProps({} as never)).resolves.toEqual({
      props: { stats, visualSameness: makeVisualSameness() },
    });

    const error = jest.spyOn(console, "error").mockImplementation(() => {});
    computeVisualSamenessStats.mockRejectedValueOnce(new Error("corrupt database"));
    await expect(getStaticProps({} as never)).resolves.toEqual({
      props: { stats, visualSameness: null },
    });
    expect(error).toHaveBeenCalledWith(
      "Failed to compute visual sameness stats",
      expect.any(Error),
    );
    error.mockRestore();
  });
});
