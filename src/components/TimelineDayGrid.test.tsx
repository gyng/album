/**
 * @jest-environment jsdom
 */

import { render, screen } from "@testing-library/react";
import { TimelineDayGrid } from "./TimelineDayGrid";
import { TimelineEntry } from "./timelineTypes";

jest.mock("next/link", () => ({
  __esModule: true,
  default: ({
    href,
    children,
    className,
  }: {
    href: string;
    children: React.ReactNode;
    className?: string;
  }) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}));

jest.mock("./MapWorldDeferred", () => ({
  MapWorldDeferred: ({ className }: { className: string }) => (
    <div data-testid="timeline-map" className={className} />
  ),
}));

describe("TimelineDayGrid", () => {
  beforeEach(() => {
    jest.spyOn(Date, "now").mockReturnValue(new Date("2024-01-03T12:00:00.000Z").getTime());
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  const entries: TimelineEntry[] = [
    {
      album: "kansai",
      date: "2024-01-02",
      dateTimeOriginal: "2024-01-02T12:00:00.000Z",
      decLat: 35.6,
      decLng: 139.7,
      geocode: "JP\nAkihabara\n35.6\n139.7\n77200\nTokyo\nChiyoda-ku\nJapan",
      src: { src: "/a.jpg", width: 200, height: 150 },
      href: "/album/kansai#a.jpg",
      path: "/data/albums/kansai/a.jpg",
      placeholderColor: "rgb(1, 2, 3)",
      placeholderWidth: 200,
      placeholderHeight: 150,
    },
    {
      album: "tokyo",
      date: "2024-01-02",
      dateTimeOriginal: "2024-01-02T16:00:00.000Z",
      decLat: null,
      decLng: null,
      geocode: "JP\nŌme\n35.7\n139.2\n131895\nTokyo\nJapan",
      src: { src: "/b.jpg", width: 200, height: 150 },
      href: "/album/tokyo#b.jpg",
      path: "/data/albums/tokyo/b.jpg",
      placeholderColor: "rgb(4, 5, 6)",
      placeholderWidth: 200,
      placeholderHeight: 150,
    },
  ];

  it("renders a wrapping day grid with photo links for the selected date", () => {
    render(<TimelineDayGrid date="2024-01-02" entries={entries} />);

    expect(screen.getByRole("heading", { name: /january 2, 2024/i })).toBeTruthy();
    expect(screen.getByText("2 photos")).toBeTruthy();
    expect(screen.getByLabelText("Location summary").textContent).toContain("Akihabara, Chiyoda-ku, Japan");
    expect(screen.getByText("yesterday")).toBeTruthy();
    expect(screen.getByText("20 hours ago")).toBeTruthy();
    expect(screen.getByText("kansai")).toBeTruthy();
    expect(screen.getByText("tokyo")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Map" })).toBeTruthy();
    expect(screen.getByText("1 mapped photo")).toBeTruthy();
    expect(screen.getByTestId("timeline-map")).toBeTruthy();
    expect(
      document.querySelector('a[href="/album/kansai#a.jpg"]'),
    ).toBeTruthy();
    expect(
      document.querySelector('a[href="/album/tokyo#b.jpg"]'),
    ).toBeTruthy();
    expect(
      document.querySelector(
        'a[href="/search?similar=..%2Falbums%2Fkansai%2Fa.jpg"]',
      ),
    ).toBeTruthy();
    expect(
      document.querySelector(
        'a[href="/search?similar=..%2Falbums%2Ftokyo%2Fb.jpg"]',
      ),
    ).toBeTruthy();
  });

  it("renders an empty state when no date is selected", () => {
    render(<TimelineDayGrid date={null} entries={[]} onSelectRandomDate={() => {}} />);

    expect(screen.getByRole("heading", { name: /pick a day/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /random/i })).toBeTruthy();
  });
});
