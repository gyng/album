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

    const sources = Array.from(
      screen.getByTestId("picture").querySelectorAll("source")
    );
    expect(sources).toHaveLength(2);
    expect(sources[0].srcset).toBe(
      "monkey.optimised.jpg, monkey.optimised.2.jpg 2x, monkey.optimised.2.jpg 3x"
    );
    expect(sources[1].srcset).toBe(
      "monkey.optimised.2.jpg, monkey.optimised.2.jpg 2x, monkey.optimised.2.jpg 3x"
    );
    const img = screen.getByTestId("picture").querySelector("img");
    expect(img!.src).toBe("http://localhost/test/monkey.jpg");
  });
});
