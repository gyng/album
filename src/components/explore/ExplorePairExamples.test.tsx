/** @jest-environment jsdom */
import { fireEvent, render, screen } from "@testing-library/react";
import { ExplorePairExamples } from "./ExplorePairExamples";

const examples = Array.from({ length: 14 }, (_, index) => ({
  left: {
    path: `left-${index}`,
    src: `/left-${index}.avif`,
    href: `/album/test#left-${index}`,
    label: `Left ${index}`,
  },
  right: {
    path: `right-${index}`,
    src: `/right-${index}.avif`,
    href: `/album/test#right-${index}`,
    label: `Right ${index}`,
  },
  similarityPercent: 95,
}));

it.each([342, 1024])(
  "opens with three rows of pairs at width %s and adds a row",
  (availableWidth) => {
    const width = jest
      .spyOn(HTMLElement.prototype, "clientWidth", "get")
      .mockReturnValue(availableWidth);
    const bounds = jest
      .spyOn(HTMLElement.prototype, "getBoundingClientRect")
      .mockReturnValue({ width: 308 } as DOMRect);
    try {
      render(<ExplorePairExamples kind="repeated" examples={examples} />);
      const columns = Math.floor(availableWidth / 308);
      expect(screen.getAllByRole("img")).toHaveLength(columns * 3 * 2);
      fireEvent.click(screen.getByRole("button", { name: "Load more repeated motifs" }));
      expect(screen.getAllByRole("img")).toHaveLength(columns * 4 * 2);
    } finally {
      width.mockRestore();
      bounds.mockRestore();
    }
  },
);

it("shows a short travelling set completely without a More control", () => {
  render(
    <ExplorePairExamples
      kind="travelling"
      examples={examples.slice(0, 2).map((pair) => ({
        ...pair,
        left: { ...pair.left, place: "Kyoto" },
        right: { ...pair.right, place: "Taipei" },
      }))}
    />,
  );
  expect(screen.getAllByRole("img")).toHaveLength(4);
  expect(screen.getAllByText("Kyoto → Taipei")).toHaveLength(2);
  expect(screen.queryByRole("button")).toBeNull();
});
