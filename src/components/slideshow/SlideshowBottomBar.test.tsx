/**
 * @jest-environment jsdom
 */

import { render, screen } from "@testing-library/react";
import type { RandomPhotoRow } from "../search/api";
import { extractDateFromExifString, extractGPSFromExifString } from "../../util/extractExifFromDb";
import {
  describeRemix,
  getRemixSwatchRgb,
  getTimeAffinityScore,
} from "../../util/slideshowAmbient";
import { getRelativeTimeString } from "../../util/time";
import { SlideshowBottomBar } from "./SlideshowBottomBar";

const mapProps = jest.fn();
jest.mock("../Map", () => ({
  __esModule: true,
  default: (props: unknown) => {
    mapProps(props);
    return <div data-testid="slide-map" />;
  },
}));
jest.mock("../../util/extractExifFromDb", () => ({
  extractDateFromExifString: jest.fn((value: string) =>
    value.includes("date") ? new Date(2024, 0, 2, 10, 0, 0) : null,
  ),
  extractGPSFromExifString: jest.fn((value: string) =>
    value.includes("coords1") ? [1, 103] : value.includes("coords2") ? [2, 104] : null,
  ),
}));
jest.mock("../../util/time", () => ({
  getRelativeTimeString: jest.fn(() => "recently"),
}));
jest.mock("../../util/slideshowAmbient", () => ({
  describeRemix: jest.fn(),
  getRemixSwatchRgb: jest.fn(),
  getTimeAffinityScore: jest.fn(() => 0.876),
}));

const extractDate = jest.mocked(extractDateFromExifString);
const extractGps = jest.mocked(extractGPSFromExifString);
const describeRemixMock = jest.mocked(describeRemix);
const swatch = jest.mocked(getRemixSwatchRgb);
const affinity = jest.mocked(getTimeAffinityScore);
const relativeTime = jest.mocked(getRelativeTimeString);

const photo = (path: string, exif: string, geocode = ""): RandomPhotoRow => ({
  path,
  exif,
  geocode,
});

const baseProps = () => ({
  slidePhotos: [photo("one.jpg", "date coords1", "Tokyo\n35.0\nKanto\nJapan")],
  showDetails: true,
  showMap: true,
  showClock: true,
  timeAware: true,
  detailsAlignment: "left" as const,
  remixStrategy: null,
  remixVectorScore: null,
  time: new Date(2024, 0, 3, 14, 5, 0),
});

describe("SlideshowBottomBar", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    describeRemixMock.mockReturnValue(null);
    swatch.mockReturnValue(null);
    affinity.mockReturnValue(0.876);
    relativeTime.mockReturnValue("recently");
  });

  it("renders dated photo details, affinity, clock, and a single-coordinate map", () => {
    const { container } = render(<SlideshowBottomBar {...baseProps()} />);

    expect(screen.getAllByText("Kanto, Japan")).toHaveLength(2);
    expect(screen.getAllByText(/recently · January 2024/)).toHaveLength(2);
    expect(screen.getAllByText("🌅 88% match")).toHaveLength(2);
    expect(screen.getAllByTestId("slide-map")).toHaveLength(1);
    expect(mapProps).toHaveBeenCalledWith(
      expect.objectContaining({
        coordinates: [1, 103],
        attribution: false,
        details: false,
        mapStyle: "toner-v2",
        projection: "vertical-perspective",
        markerStyle: { color: "var(--c-danger)" },
      }),
    );
    expect(container.querySelectorAll('[data-align="left"]')).toHaveLength(2);
    expect(affinity).toHaveBeenCalled();
  });

  it("keeps derived slide metadata stable across clock-only rerenders", () => {
    const props = baseProps();
    const view = render(<SlideshowBottomBar {...props} />);
    expect(extractDate).toHaveBeenCalledTimes(1);
    expect(extractGps).toHaveBeenCalledTimes(1);

    view.rerender(
      <SlideshowBottomBar
        {...props}
        slidePhotos={[{ ...props.slidePhotos[0], exif: "changed" }]}
        time={new Date(2024, 0, 3, 14, 5, 1)}
      />,
    );
    expect(extractDate).toHaveBeenCalledTimes(1);
    expect(extractGps).toHaveBeenCalledTimes(1);
  });

  it("uses all located companions for a multi-point map and leaves missing metadata blank", () => {
    const props = baseProps();
    render(
      <SlideshowBottomBar
        {...props}
        slidePhotos={[
          props.slidePhotos[0],
          photo("two.jpg", "coords2", ""),
          photo("three.jpg", "date", "1.2\n3.4"),
        ]}
        showDetails={false}
        showMap={false}
        showClock={false}
        timeAware={false}
        detailsAlignment="right"
      />,
    );
    expect(mapProps).toHaveBeenCalledWith(
      expect.objectContaining({
        coordinates: [
          [1, 103],
          [2, 104],
        ],
      }),
    );
    expect(screen.queryByText(/% match/)).toBeNull();
    expect(document.querySelectorAll('[data-count="3"][data-align="right"]')).toHaveLength(2);
  });

  it("does not create a map when the slide has no coordinates", () => {
    relativeTime.mockReturnValue(null);
    render(<SlideshowBottomBar {...baseProps()} slidePhotos={[photo("plain.jpg", "date", "")]} />);
    expect(screen.queryByTestId("slide-map")).toBeNull();
    expect(screen.getAllByText("January 2024")).toHaveLength(2);
  });

  it("describes a remixed slide with an optional swatch and descriptor", () => {
    describeRemixMock.mockReturnValue("same camera body");
    swatch.mockReturnValue([12, 34, 56]);
    const props = baseProps();
    render(
      <SlideshowBottomBar
        {...props}
        slidePhotos={[props.slidePhotos[0], photo("two.jpg", "coords2")]}
        remixStrategy="same-album"
      />,
    );
    expect(screen.getAllByText(/2 photos from this album/)).toHaveLength(2);
    expect(screen.getAllByText(/same camera body/)).toHaveLength(2);
    const remixSwatches = document.querySelectorAll(".remixSwatch");
    expect(remixSwatches).toHaveLength(2);
    expect(remixSwatches[0]).toHaveStyle({ backgroundColor: "rgb(12, 34, 56)" });
  });

  it.each([
    ["similar", -0.5, "0% match"],
    ["similar", 1.5, "100% match"],
    ["juxtapose", -0.5, "100% distance"],
  ] as const)("frames %s vector score %s as %s", (strategy, score, label) => {
    const props = baseProps();
    render(
      <SlideshowBottomBar
        {...props}
        slidePhotos={[props.slidePhotos[0], photo("two.jpg", "coords2")]}
        remixStrategy={strategy}
        remixVectorScore={score}
      />,
    );
    expect(screen.getAllByText(new RegExp(label.replace("%", "%")))[0]).toBeInTheDocument();
  });

  it("omits remix chrome without both companions and strategy, or without a vector score", () => {
    const props = baseProps();
    const view = render(<SlideshowBottomBar {...props} remixStrategy="similar" />);
    expect(screen.queryByText(/◫ Remix/)).toBeNull();

    view.rerender(
      <SlideshowBottomBar
        {...props}
        slidePhotos={[props.slidePhotos[0], photo("two.jpg", "coords2")]}
        remixStrategy={null}
      />,
    );
    expect(screen.queryByText(/◫ Remix/)).toBeNull();

    view.rerender(
      <SlideshowBottomBar
        {...props}
        slidePhotos={[props.slidePhotos[0], photo("two.jpg", "coords2")]}
        remixStrategy="similar"
        remixVectorScore={null}
        timeAware={false}
      />,
    );
    expect(screen.getAllByText(/semantically similar/)).toHaveLength(2);
    expect(screen.queryByText(/% match/)).toBeNull();
  });
});
