/**
 * @jest-environment jsdom
 */

import { createRef } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { SearchInputBar } from "./SearchInputBar";

const callbacks = () => ({
  onApplySearchTerms: jest.fn(),
  onClearSearchState: jest.fn(),
  onStartRandomSimilarSearch: jest.fn(),
  onSetSearchMode: jest.fn(),
  onPickImageQuery: jest.fn(),
  onOpenDrawPad: jest.fn(),
});

const baseProps = () => ({
  canClear: false,
  databaseReady: true,
  inputRef: createRef<HTMLInputElement>(),
  isFetching: false,
  isSimilarMode: false,
  isSuccess: false,
  queryResultsLength: undefined,
  searchInputValue: "",
  searchMode: "keyword" as const,
  trimmedQuery: "",
  ...callbacks(),
});

describe("SearchInputBar", () => {
  it("focuses search and exposes all query entry actions", () => {
    const props = baseProps();
    const { container } = render(<SearchInputBar {...props} canClear />);

    const search = screen.getByRole("textbox", { name: "Search photos" });
    expect(document.activeElement).toBe(search);
    fireEvent.change(search, { target: { value: "cats, night" } });
    expect(props.onApplySearchTerms).toHaveBeenCalledWith(["cats", " night"]);
    fireEvent.click(screen.getByRole("button", { name: "Clear search" }));
    expect(props.onClearSearchState).toHaveBeenCalled();

    fireEvent.change(screen.getByRole("combobox", { name: "Search mode" }), {
      target: { value: "semantic" },
    });
    expect(props.onSetSearchMode).toHaveBeenCalledWith("semantic");
    fireEvent.click(screen.getByRole("button", { name: /Random starting photo/ }));
    fireEvent.click(screen.getByRole("button", { name: /Draw to search/ }));
    expect(props.onStartRandomSimilarSearch).toHaveBeenCalled();
    expect(props.onOpenDrawPad).toHaveBeenCalled();

    const fileInput = container.querySelector<HTMLInputElement>('input[type="file"]')!;
    const click = jest.spyOn(fileInput, "click");
    fireEvent.click(screen.getByRole("button", { name: /Search by image/ }));
    expect(click).toHaveBeenCalled();
    const file = new File(["photo"], "photo.jpg", { type: "image/jpeg" });
    fireEvent.change(fileInput, { target: { files: [file] } });
    expect(props.onPickImageQuery).toHaveBeenCalledWith(file);
    expect(fileInput.value).toBe("");
    fireEvent.change(fileInput, { target: { files: [] } });
    expect(props.onPickImageQuery).toHaveBeenCalledTimes(1);
  });

  it("connects search help to a native popover", () => {
    render(<SearchInputBar {...baseProps()} />);
    const help = screen.getByRole("button", { name: "Search mode help" });
    const tooltip = screen.getByRole("tooltip");
    expect(help).toHaveAttribute("popovertarget", tooltip.id);
    expect(tooltip).toHaveAttribute("popover", "auto");
  });

  it("disables database-backed actions and explains an unavailable index", () => {
    render(<SearchInputBar {...baseProps()} databaseReady={false} disabled />);
    expect(screen.getByRole("textbox", { name: "Search photos" })).toHaveAttribute(
      "title",
      expect.stringContaining("Disabled:"),
    );
    expect(screen.getByRole("button", { name: /Random starting photo/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: /Search by image/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: /Draw to search/ })).toBeDisabled();
  });

  it("hides query controls during a similarity trail", () => {
    render(<SearchInputBar {...baseProps()} isSimilarMode />);
    expect(screen.queryByRole("textbox", { name: "Search photos" })).toBeNull();
    expect(screen.queryByRole("combobox", { name: "Search mode" })).toBeNull();
  });

  it("prompts for a viable keyword query only after an empty success", () => {
    const props = baseProps();
    const view = render(
      <SearchInputBar {...props} isSuccess queryResultsLength={0} trimmedQuery="ab" />,
    );
    expect(screen.getByText("Enter at least 3 characters")).toBeInTheDocument();

    view.rerender(
      <SearchInputBar {...props} isSuccess queryResultsLength={0} trimmedQuery="abc" />,
    );
    expect(screen.queryByText("Enter at least 3 characters")).toBeNull();
    view.rerender(<SearchInputBar {...props} isSuccess queryResultsLength={1} trimmedQuery="ab" />);
    expect(screen.queryByText("Enter at least 3 characters")).toBeNull();
    view.rerender(
      <SearchInputBar {...props} isSuccess isFetching queryResultsLength={0} trimmedQuery="ab" />,
    );
    expect(screen.queryByText("Enter at least 3 characters")).toBeNull();
    view.rerender(
      <SearchInputBar
        {...props}
        isSuccess
        queryResultsLength={0}
        trimmedQuery="ab"
        searchMode="semantic"
      />,
    );
    expect(screen.queryByText("Enter at least 3 characters")).toBeNull();
  });

  it("omits client-only random controls from server markup", () => {
    const markup = renderToString(<SearchInputBar {...baseProps()} />);
    expect(markup).not.toContain("Random starting photo");
  });
});
