/**
 * @jest-environment jsdom
 */

import { render, screen } from "@testing-library/react";
import SearchWithCoi from "./SearchWithCoi";

const searchProps = jest.fn();
jest.mock("./Search", () => ({
  __esModule: true,
  default: (props: unknown) => {
    searchProps(props);
    return <div data-testid="search" />;
  },
}));

describe("SearchWithCoi", () => {
  it("enables search and forwards navigation updates", () => {
    const onNavStateChange = jest.fn();
    render(<SearchWithCoi onNavStateChange={onNavStateChange} />);

    expect(screen.getByTestId("search")).toBeInTheDocument();
    expect(searchProps).toHaveBeenCalledWith({ disabled: false, onNavStateChange });
  });

  it("omits an absent optional callback", () => {
    render(<SearchWithCoi />);
    expect(searchProps).toHaveBeenLastCalledWith({ disabled: false });
  });
});
