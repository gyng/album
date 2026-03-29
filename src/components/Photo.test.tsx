/**
 * @jest-environment jsdom
 */

import { render, screen } from "@testing-library/react";
import { PhotoBlock } from "../services/types";
import { PhotoBlockEl } from "./Photo";

jest.mock("next/dynamic", () => () => () => null);

describe("PhotoBlockEl", () => {
  it("renders a PhotoBlock with Pictures", () => {
    const block: PhotoBlock = {
      kind: "photo",
      id: "foo",
      data: {
        src: "test/monkey.jpg",
      },
      _build: {
        height: 100,
        width: 100,
        exif: {},
        tags: {},
        srcset: [
          { src: "monkey.optimised.jpg", width: 100, height: 150 },
          { src: "monkey.optimised.2.jpg", width: 100, height: 150 },
        ],
      },
    };

    render(<PhotoBlockEl block={block} currentIndex={0} />);

    expect(screen.getAllByTestId("photoblockel")).toHaveLength(1);
    expect(screen.getAllByTestId("picture")).toHaveLength(1);
    expect(screen.queryByText("Similar photos")).toBeNull();

    const img: HTMLImageElement = screen.getByTestId("picture");
    expect(img!.src).toBeTruthy();
    expect(img!.srcset).toBeTruthy();
    expect(img.alt).toBe("monkey");
  });

  it("prefers explicit photo metadata for alt text", () => {
    const block: PhotoBlock = {
      kind: "photo",
      id: "foo",
      data: {
        src: "test/monkey.jpg",
        title: "Harbor skyline",
      },
      _build: {
        height: 100,
        width: 100,
        exif: {},
        tags: {},
        srcset: [
          { src: "monkey.optimised.jpg", width: 100, height: 150 },
          { src: "monkey.optimised.2.jpg", width: 100, height: 150 },
        ],
      },
    };

    render(<PhotoBlockEl block={block} currentIndex={0} />);

    expect(screen.getByTestId("picture").getAttribute("alt")).toBe(
      "Harbor skyline",
    );
  });
});
