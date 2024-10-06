import { render, screen } from "@testing-library/react";
import { PhotoBlock } from "../services/types";
import { PhotoBlockEl } from "./Photo";

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

    const img: HTMLImageElement = screen.getByTestId("picture");
    expect(img!.src).toBe("http://localhost/test/monkey.jpg");
    expect(img!.srcset).toBeTruthy();
  });
});
