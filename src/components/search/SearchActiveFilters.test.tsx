/**
 * @jest-environment jsdom
 */

import { fireEvent, render, screen } from "@testing-library/react";
import { SearchActiveFilters } from "./SearchActiveFilters";

describe("SearchActiveFilters", () => {
  it("renders every active filter domain and dispatches removals", () => {
    const onClearImage = jest.fn();
    const onClearColour = jest.fn();
    const onRemoveTerm = jest.fn();
    const onRemoveFacet = jest.fn();
    const facet = { facetId: "year", value: "2024" };

    render(
      <SearchActiveFilters
        imageQuery={{
          id: 1,
          source: "drawing",
          previewUrl: "blob:preview",
          vector: null,
        }}
        colour={[93, 132, 214]}
        searchTerms={["night"]}
        selectedFacets={[facet]}
        onClearImage={onClearImage}
        onClearColour={onClearColour}
        onRemoveTerm={onRemoveTerm}
        onRemoveFacet={onRemoveFacet}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Remove image query" }));
    fireEvent.click(
      screen.getByRole("button", { name: /remove filter colour/i }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Remove filter night" }));
    fireEvent.click(
      screen.getByRole("button", { name: /remove filter year: 2024/i }),
    );

    expect(onClearImage).toHaveBeenCalledTimes(1);
    expect(onClearColour).toHaveBeenCalledTimes(1);
    expect(onRemoveTerm).toHaveBeenCalledWith("night");
    expect(onRemoveFacet).toHaveBeenCalledWith(facet);
    expect(screen.getByTestId("image-query-zoom")).toBeTruthy();
  });

  it("renders nothing when no filters are active", () => {
    const { container } = render(
      <SearchActiveFilters
        imageQuery={null}
        colour={null}
        searchTerms={[]}
        selectedFacets={[]}
        onClearImage={() => {}}
        onClearColour={() => {}}
        onRemoveTerm={() => {}}
        onRemoveFacet={() => {}}
      />,
    );

    expect(container).toBeEmptyDOMElement();
  });
});
