/**
 * @jest-environment jsdom
 */

import { render, screen } from "@testing-library/react";
import { TextBlock } from "../services/types";
import { TextBlockEl } from "./TextBlock";

describe("TextBlockEl", () => {
  it("renders the available editorial fields and omits absent optional fields", () => {
    const block: TextBlock = {
      kind: "text",
      id: "introduction",
      data: {
        title: "A northern journey",
        kicker: "Field notes",
        description: "Photographs from the coast.",
      },
    };
    const { rerender } = render(<TextBlockEl block={block} currentIndex={0} />);

    expect(screen.getByRole("heading", { name: "A northern journey" })).toBeTruthy();
    expect(screen.getByText("Field notes")).toBeTruthy();
    expect(screen.getByText("Photographs from the coast.")).toBeTruthy();

    rerender(
      <TextBlockEl
        block={{ kind: "text", id: "title-only", data: { title: "Title only" } }}
        currentIndex={1}
      />,
    );
    expect(screen.getByRole("heading", { name: "Title only" })).toBeTruthy();
    expect(screen.queryByText("Field notes")).toBeNull();
    expect(screen.queryByText("Photographs from the coast.")).toBeNull();
  });
});
