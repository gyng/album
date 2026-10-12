/** @jest-environment jsdom */
import { fireEvent, render, screen } from "@testing-library/react";
import { ExploreLookYearPhotos } from "./ExploreLookYearPhotos";

const photos = Array.from({ length: 8 }, (_, index) => ({
  path: `../albums/test/${index}.jpg`,
  src: `/${index}.avif`,
  href: `/album/test#${index}`,
  label: `Year photo ${index}`,
}));

it("reveals more photos from the year in batches", () => {
  render(<ExploreLookYearPhotos year={2026} photos={photos} />);
  expect(screen.getAllByRole("img")).toHaveLength(3);
  fireEvent.click(screen.getByRole("button", { name: "More photos from 2026" }));
  expect(screen.getAllByRole("img")).toHaveLength(6);
  fireEvent.click(screen.getByRole("button", { name: "More photos from 2026" }));
  expect(screen.getAllByRole("img")).toHaveLength(8);
  expect(screen.queryByRole("button", { name: "More photos from 2026" })).toBeNull();
});

it("randomises the visible set within the year without repeating photos", () => {
  render(<ExploreLookYearPhotos year={2026} photos={photos} />);
  const shown = () => screen.getAllByRole("img").map((image) => image.getAttribute("src"));
  const before = shown();
  fireEvent.click(screen.getByRole("button", { name: "Random photos from 2026" }));
  const after = shown();
  expect(after).not.toEqual(before);
  expect(after).toHaveLength(3);
  expect(new Set(after).size).toBe(3);
  expect(after.every((src) => photos.some((photo) => photo.src === src))).toBe(true);
});

it("omits controls when the entire year already fits", () => {
  render(<ExploreLookYearPhotos year={2026} photos={photos.slice(0, 2)} />);
  expect(screen.queryByRole("button")).toBeNull();
});

it("fills the available first row and reveals another complete row", () => {
  const width = jest.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(780);
  try {
    const many = Array.from({ length: 20 }, (_, index) => ({
      ...photos[0]!,
      path: `/${index}.jpg`,
      src: `/${index}.avif`,
      label: `Photo ${index}`,
    }));
    render(<ExploreLookYearPhotos year={2026} photos={many} />);
    expect(screen.getAllByRole("img")).toHaveLength(7);
    fireEvent.click(screen.getByRole("button", { name: "More photos from 2026" }));
    expect(screen.getAllByRole("img")).toHaveLength(14);
  } finally {
    width.mockRestore();
  }
});
