/**
 * @jest-environment jsdom
 */

import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { MapContextMenu } from "./MapContextMenu";

const popupProps = jest.fn();
jest.mock("./map/adapters/maplibre", () => ({
  Popup: ({ children, ...props }: { children?: ReactNode }) => {
    popupProps(props);
    return <div data-testid="popup">{children}</div>;
  },
}));

describe("MapContextMenu", () => {
  beforeEach(() => popupProps.mockClear());

  it("stays hidden until a location is selected", () => {
    const { container } = render(
      <MapContextMenu point={null} onClose={jest.fn()} onInteractionStart={jest.fn()} />,
    );

    expect(container).toBeEmptyDOMElement();
  });

  it("offers precise external-map actions without bubbling activation", () => {
    const onClose = jest.fn();
    const onInteractionStart = jest.fn();
    const onParentClick = jest.fn();
    const onParentKeyDown = jest.fn();
    render(
      // This non-interactive wrapper exists only to observe whether the links'
      // React events escape the component boundary.
      // oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
      <div
        role="group"
        aria-label="Test harness"
        onClick={onParentClick}
        onKeyDown={onParentKeyDown}
      >
        <MapContextMenu
          point={{ latitude: 1.234567, longitude: 103.765432 }}
          onClose={onClose}
          onInteractionStart={onInteractionStart}
        />
      </div>,
    );

    expect(screen.getByText("1.23457, 103.76543")).toBeInTheDocument();
    const google = screen.getByRole("link", { name: /Open in Google Maps/ });
    const osm = screen.getByRole("link", { name: /Open in OpenStreetMap/ });
    expect(google).toHaveAttribute(
      "href",
      "https://www.google.com/maps/search/?api=1&query=1.234567%2C103.765432",
    );
    expect(osm).toHaveAttribute(
      "href",
      "https://www.openstreetmap.org/?mlat=1.234567&mlon=103.765432&zoom=13",
    );

    fireEvent.mouseDown(google);
    fireEvent.keyDown(google, { key: "Enter" });
    fireEvent.click(google);
    fireEvent.mouseDown(osm);
    fireEvent.keyDown(osm, { key: "Enter" });
    fireEvent.click(osm);
    expect(onInteractionStart).toHaveBeenCalledTimes(2);
    expect(onParentClick).not.toHaveBeenCalled();
    expect(onParentKeyDown).not.toHaveBeenCalled();
    expect(popupProps).toHaveBeenCalledWith(
      expect.objectContaining({
        latitude: 1.234567,
        longitude: 103.765432,
        onClose,
        closeButton: false,
        closeOnClick: false,
      }),
    );
  });
});
