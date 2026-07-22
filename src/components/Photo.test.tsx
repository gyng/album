/**
 * @jest-environment jsdom
 */

import { fireEvent, render, screen } from "@testing-library/react";
import { PhotoBlock } from "../services/types";
import { ExifRow, ExifTable, Picture, PhotoBlockEl, PhotoDescription } from "./Photo";

jest.mock("./MapDeferred", () => ({
  MapDeferred: ({ coordinates }: { coordinates: [number, number] }) => (
    <div data-testid="photo-map">{coordinates.join(",")}</div>
  ),
}));

jest.mock("./PhotoSimilarPhotosDeferred", () => ({
  PhotoSimilarPhotosDeferred: () => <p>Loading similar photos…</p>,
}));

type BlockOptions = {
  data?: Partial<PhotoBlock["data"]>;
  exif?: PhotoBlock["_build"]["exif"];
  tags?: PhotoBlock["_build"]["tags"];
  formatting?: PhotoBlock["formatting"];
  srcset?: PhotoBlock["_build"]["srcset"];
  width?: number;
  height?: number;
};

const createBlock = (options: BlockOptions = {}): PhotoBlock => ({
  kind: "photo",
  id: "photo-one",
  data: {
    src: "test/monkey.jpg",
    ...options.data,
  },
  ...(options.formatting ? { formatting: options.formatting } : {}),
  _build: {
    height: options.height ?? 100,
    width: options.width ?? 100,
    exif: options.exif ?? {},
    tags: options.tags ?? {},
    srcset: options.srcset ?? [
      { src: "monkey.optimised.jpg", width: 100, height: 150 },
      { src: "monkey.optimised.2.jpg", width: 200, height: 300 },
    ],
  },
});

const openPhotoDetails = (container: HTMLElement): void => {
  const details = container.querySelector("details");
  if (!details) {
    throw new Error("Expected photo details control");
  }
  details.open = true;
  fireEvent(details, new Event("toggle", { bubbles: true }));
};

describe("PhotoBlockEl", () => {
  it("renders a PhotoBlock with Pictures", () => {
    const block = createBlock();

    const { container } = render(<PhotoBlockEl block={block} currentIndex={0} />);

    expect(screen.getAllByTestId("photoblockel")).toHaveLength(1);
    expect(screen.getAllByTestId("picture")).toHaveLength(1);
    expect(screen.queryByText("Similar photos")).toBeNull();

    const detailsControl = screen.getByLabelText("Photo details");
    expect(detailsControl.querySelector("svg")).not.toBeNull();
    expect(detailsControl.textContent).toBe("");

    const img: HTMLImageElement = screen.getByTestId("picture");
    expect(img!.src).toBeTruthy();
    expect(img!.srcset).toBeTruthy();
    expect(img.alt).toBe("monkey");

    openPhotoDetails(container);
    expect(screen.queryByText("Shutter speed")).toBeNull();
    expect(screen.queryByText("Camera datetime")).toBeNull();
  });

  it("prefers explicit photo metadata for alt text", () => {
    const block = createBlock({ data: { title: "Harbour skyline" } });

    render(<PhotoBlockEl block={block} currentIndex={0} />);

    expect(screen.getByTestId("picture").getAttribute("alt")).toBe("Harbour skyline");
  });

  it("reveals rich photo metadata and search actions when details are opened", () => {
    const block = createBlock({
      data: {
        title: "Evening in Tokyo",
        kicker: "Japan",
        description: "Lanterns at dusk",
      },
      formatting: { immersive: true },
      width: 6000,
      height: 4000,
      exif: {
        GPSLatitudeRef: "N",
        GPSLatitude: [35, 41, 22.4],
        GPSLongitudeRef: "E",
        GPSLongitude: [139, 41, 30.6],
        ExposureTime: 0.01,
        ISO: 400,
        FNumber: 2,
        ExposureCompensation: 0,
        FocalLength: 23,
        FocalLengthIn35mmFormat: 35,
        LensMake: "FUJIFILM",
        LensModel: "XF23mmF2",
        Make: "FUJIFILM",
        Model: "X-T5",
        ImageDescription: "Camera description",
        DateTimeOriginal: "2024:04:05 18:30:00",
        OffsetTime: "+09:00",
      },
      tags: {
        geocode: "Tokyo\nJapan\nunused\nunused\nunused\nChiyoda\nKanto",
        tags: ["night", "street"],
        colors: [[12, 34, 56]],
        alt_text: "Lantern-lined Tokyo street",
        path: "../albums/japan/lanterns.jpg",
      },
      srcset: [
        { src: "lanterns-1200.avif", width: 1200, height: 800 },
        { src: "lanterns-2400.avif", width: 2400, height: 1600 },
      ],
    });

    const { container } = render(<PhotoBlockEl block={block} currentIndex={3} />);

    expect(screen.getByRole("heading", { name: "Evening in Tokyo" })).toBeTruthy();
    expect(screen.getByText("Japan")).toBeTruthy();
    expect(screen.getByText("Lanterns at dusk")).toBeTruthy();
    expect(screen.getByTestId("picture").getAttribute("loading")).toBe("lazy");

    openPhotoDetails(container);

    expect(screen.getByText("1⁄100s")).toBeTruthy();
    expect(screen.getByText("23mm (actual); 35mm (35mm equivalent)")).toBeTruthy();
    expect(screen.getByText("FUJIFILM XF23mmF2")).toBeTruthy();
    expect(screen.getByText("FUJIFILM X-T5")).toBeTruthy();
    expect(
      screen.getByText(
        (_, element) =>
          element?.tagName === "TD" &&
          element.textContent?.startsWith("2024-04-05T18:30:00 (local @ +09:00)") === true,
      ),
    ).toBeTruthy();
    expect(screen.getByText("Japan, Chiyoda, Kanto")).toBeTruthy();
    expect(screen.getByTestId("photo-map")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Find photos from this place" })).toHaveAttribute(
      "href",
      expect.stringContaining("location%3AKanto"),
    );
    expect(screen.getByRole("link", { name: "Find photos at this ISO" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Find photos at this aperture" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Find photos with this focal length" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Find photos with this lens" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Find photos with this camera" })).toBeTruthy();
    expect(
      screen.getByRole("link", { name: "Search photos with similar colour rgb(12, 34, 56)" }),
    ).toHaveAttribute("href", "/search?color=12,34,56");
    expect(screen.getByText("Loading similar photos…")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Permalink" })).toHaveAttribute("href", "#photo-one");
    expect(screen.getByRole("link", { name: "1200px" })).toHaveAttribute(
      "href",
      "lanterns-1200.avif",
    );
    expect(screen.getByRole("link", { name: "2400px" })).toHaveAttribute(
      "href",
      "lanterns-2400.avif",
    );
    expect(screen.getByText("Raw EXIF")).toBeTruthy();
    expect(screen.getByText("License")).toBeTruthy();
  });

  it("renders long exposures and metadata fallbacks without inventing facet actions", () => {
    const block = createBlock({
      exif: {
        ExposureTime: 2,
        FocalLength: 200,
        LensInfo: "18-200mm f/3.5-6.3",
        DateTimeOriginal: "2023:02:03 04:05:06",
      },
    });
    const { container } = render(<PhotoBlockEl block={block} currentIndex={0} />);

    openPhotoDetails(container);

    expect(screen.getByText("2s")).toBeTruthy();
    expect(screen.getByText("200mm (actual)")).toBeTruthy();
    expect(screen.getByText("18-200mm f/3.5-6.3")).toBeTruthy();
    expect(
      screen.getByText(
        (_, element) =>
          element?.tagName === "TD" &&
          element.textContent?.startsWith("2023-02-03T04:05:06") === true,
      ),
    ).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Find photos at this ISO" })).toBeNull();
  });

  it("hides the camera datetime row entirely when DateTimeOriginal is unparseable", () => {
    // Truthy but not matched by the EXIF-ish datetime pattern in exifTime.ts,
    // so both the formatted local string and the relative-time value are
    // null — the row must not render a bare label with a blank/broken value.
    const block = createBlock({
      exif: {
        DateTimeOriginal: "not-a-real-timestamp",
      },
    });
    const { container } = render(<PhotoBlockEl block={block} currentIndex={0} />);

    openPhotoDetails(container);

    expect(screen.queryByText("Camera datetime")).toBeNull();
  });
});

describe("ExifTable", () => {
  it("renders a numeric 0 value such as exposure compensation 0 EV", () => {
    render(<ExifTable rows={[{ kind: "kv", k: "Exposure compensation", v: 0 }]} />);

    expect(screen.getByText("Exposure compensation")).toBeTruthy();
    expect(screen.getByText("0")).toBeTruthy();
  });

  it("hides empty-string and null values", () => {
    render(
      <ExifTable
        rows={[
          { kind: "kv", k: "Description", v: "" },
          { kind: "kv", k: "Missing", v: null },
        ]}
      />,
    );

    expect(screen.queryByText("Description")).toBeNull();
    expect(screen.queryByText("Missing")).toBeNull();
  });

  it("honours explicit row validity and rejects unsupported row kinds", () => {
    const { rerender } = render(
      <ExifTable rows={[{ kind: "kv", k: "Hidden", v: "value", valid: false }]} />,
    );
    expect(screen.queryByText("Hidden")).toBeNull();

    rerender(
      <table>
        <tbody>
          <ExifRow k="Also hidden" v="value" valid={false} />
        </tbody>
      </table>,
    );
    expect(screen.queryByText("Also hidden")).toBeNull();

    const consoleError = jest.spyOn(console, "error").mockImplementation(() => undefined);
    expect(() =>
      render(<ExifTable rows={[{ kind: "unsupported", k: "Bad", v: "value" } as never]} />),
    ).toThrow("Unsupported type unsupported");
    consoleError.mockRestore();
  });

  it("renders coordinate seconds and geocode without a map when disabled", () => {
    const { container } = render(
      <ExifTable
        rows={[
          {
            kind: "coordinates",
            k: "Location",
            v: {
              GPSLatitudeRef: "S",
              GPSLatitude: [33, 52, 7.8],
              GPSLongitudeRef: "E",
              GPSLongitude: [151, 12, 33.2],
              geocode: "Sydney\nAustralia\nunused\nunused\nunused\nNew South Wales",
            },
            options: { showMap: false },
          },
        ]}
      />,
    );

    expect(screen.getByText("33° 52′ 8″ S 151° 12′ 33″ E")).toBeTruthy();
    expect(screen.getByText("Australia, New South Wales")).toBeTruthy();
    expect(container.querySelectorAll("tbody tr")).toHaveLength(1);
  });

  it("keeps the mini-map row for equator/meridian (0, 0) coordinates", () => {
    const { container } = render(
      <ExifTable
        rows={[
          {
            kind: "coordinates",
            k: "Location",
            v: {
              GPSLatitudeRef: "N",
              GPSLatitude: [0, 0, 0],
              GPSLongitudeRef: "E",
              GPSLongitude: [0, 0, 0],
            },
            options: { showMap: true },
          },
        ]}
      />,
    );

    // Coordinate text row + map row. The old falsy check dropped the map row
    // when both coordinates were exactly 0.
    expect(container.querySelectorAll("tbody tr")).toHaveLength(2);
  });
});

describe("small photo presentation helpers", () => {
  it("renders a photo description and a visible EXIF row", () => {
    const { rerender } = render(<PhotoDescription description="A quiet lane" />);
    expect(screen.getByText("A quiet lane")).toBeTruthy();

    rerender(
      <table>
        <tbody>
          <ExifRow k="Software" v="Camera firmware" />
        </tbody>
      </table>,
    );
    expect(screen.getByText("Software")).toBeTruthy();
    expect(screen.getByText("Camera firmware")).toBeTruthy();
  });
});

describe("Picture", () => {
  const block = createBlock({
    srcset: [
      { src: "monkey@800.avif", width: 800, height: 1200 },
      { src: "monkey@1600.avif", width: 1600, height: 2400 },
      { src: "monkey@3200.avif", width: 3200, height: 4800 },
    ],
  });

  it("emits full srcset and `sizes=auto, 100vw` for full-size photos", () => {
    render(<Picture block={block} />);

    const img: HTMLImageElement = screen.getByTestId("picture");
    expect(img.getAttribute("srcset")).toBe(
      "monkey@800.avif 800w, monkey@1600.avif 1600w, monkey@3200.avif 3200w",
    );
    expect(img.getAttribute("sizes")).toBe("auto, 100vw");
  });

  it("uses 1600px and larger candidates for thumbnails", () => {
    render(<Picture block={block} thumb />);

    const img: HTMLImageElement = screen.getByTestId("picture");
    expect(img.getAttribute("srcset")).toBe("monkey@1600.avif 1600w, monkey@3200.avif 3200w");
    expect(img.getAttribute("src")).toBe("monkey@1600.avif");
    expect(img.getAttribute("sizes")).toBe("auto, 800px");
  });

  it("keeps every candidate when a thumbnail has no 1600px source", () => {
    const smallBlock = createBlock({
      srcset: [
        { src: "small@400.avif", width: 400, height: 600 },
        { src: "small@800.avif", width: 800, height: 1200 },
      ],
    });

    render(<Picture block={smallBlock} thumb />);

    const img: HTMLImageElement = screen.getByTestId("picture");
    expect(img.getAttribute("srcset")).toBe("small@400.avif 400w, small@800.avif 800w");
    expect(img.getAttribute("src")).toBe("small@400.avif");
  });

  it.each(["Rotate 90 CW", "Rotate 270 CW"])(
    "swaps dimensions for the EXIF orientation %s and clears the colour placeholder on load",
    (orientation) => {
      const portraitBlock = createBlock({
        width: 600,
        height: 400,
        exif: { Orientation: orientation },
        tags: { colors: [[12, 34, 56]] },
      });
      render(
        <Picture
          block={portraitBlock}
          thumb
          lazy={false}
          label="Portrait photograph"
          useColourPlaceholder
        />,
      );

      const img: HTMLImageElement = screen.getByTestId("picture");
      expect(img.width).toBe(400);
      expect(img.height).toBe(600);
      expect(img.getAttribute("loading")).toBe("eager");
      expect(img.getAttribute("aria-label")).toBe("Portrait photograph");
      expect(img.style.backgroundImage).toContain("data:image/svg+xml;base64");
      expect(img.style.backgroundSize).toBe("cover");

      fireEvent.load(img);
      expect(img.style.backgroundImage).toBe("unset");
    },
  );
});
