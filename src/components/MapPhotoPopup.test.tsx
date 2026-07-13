/**
 * @jest-environment jsdom
 */

import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import type { MapWorldEntry } from "./MapWorld";
import { MapPhotoPopup } from "./MapPhotoPopup";

jest.mock("react-map-gl/maplibre", () => ({
  Popup: ({ children }: { children?: ReactNode }) => <div data-testid="popup">{children}</div>,
}));

jest.mock("../util/time", () => ({
  getRelativeTimeString: () => "two years ago",
}));

const photo: MapWorldEntry = {
  album: "kansai",
  src: { src: "/photo.jpg", width: 100, height: 100 },
  decLat: 35.6762,
  decLng: 139.6503,
  date: "2024-01-02T03:04:05",
  href: "/album/kansai#photo.jpg",
};

describe("MapPhotoPopup", () => {
  it("renders selected-photo details and pauses route sync before link interaction", () => {
    const onInteractionStart = jest.fn();

    render(
      <MapPhotoPopup
        photo={photo}
        selected
        onClose={jest.fn()}
        onInteractionStart={onInteractionStart}
      />,
    );

    expect(
      screen.getByText(
        (_content, element) =>
          element?.tagName === "SPAN" && element.textContent === "2 Jan 2024, 03:04two years ago",
      ),
    ).toBeTruthy();
    expect(screen.getByRole("link", { name: /Google Maps/ })).toBeTruthy();
    expect(screen.getByRole("link", { name: /OpenStreetMap/ })).toBeTruthy();

    fireEvent.mouseDown(screen.getByRole("link", { name: /kansai/i }));
    expect(onInteractionStart).toHaveBeenCalledTimes(1);
  });

  it("omits external map links for a hover-only popup", () => {
    render(
      <MapPhotoPopup
        photo={photo}
        selected={false}
        onClose={jest.fn()}
        onInteractionStart={jest.fn()}
      />,
    );

    expect(screen.queryByRole("link", { name: /OpenStreetMap/ })).toBeNull();
  });
});
