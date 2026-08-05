/**
 * @jest-environment jsdom
 */

import { fireEvent, render, screen } from "@testing-library/react";
import { MapStyleToggle } from "./MapStyleToggle";
import { AUTO_MAP_STYLE, MAP_STYLE_STORAGE_KEY, resetMapStyleCache } from "../util/mapStyles";

beforeEach(() => {
  window.localStorage.clear();
  resetMapStyleCache();
});

const picker = () => screen.getByRole("combobox", { name: "Map style" }) as HTMLSelectElement;

describe("MapStyleToggle", () => {
  // The picker used to open on the name of whatever the theme had supplied,
  // which read as a decision the reader had made — and once they made a real
  // one there was no row to go back to.
  it("opens on matching the theme rather than on a basemap", () => {
    render(<MapStyleToggle />);

    expect(picker().value).toBe(AUTO_MAP_STYLE);
    expect(screen.getByRole("option", { name: "Match theme" })).toBeInTheDocument();
  });

  it("remembers a basemap, and remembers going back to the theme", () => {
    render(<MapStyleToggle />);

    fireEvent.change(picker(), { target: { value: "halftone" } });
    expect(picker().value).toBe("halftone");
    expect(window.localStorage.getItem(MAP_STYLE_STORAGE_KEY)).toBe("halftone");

    fireEvent.change(picker(), { target: { value: AUTO_MAP_STYLE } });
    expect(picker().value).toBe(AUTO_MAP_STYLE);
    expect(window.localStorage.getItem(MAP_STYLE_STORAGE_KEY)).toBe(AUTO_MAP_STYLE);
  });
});
