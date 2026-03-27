export const getResizedAlbumImageSrc = (path: string): string => {
  const imageSrc = path.replace("..", "data");
  return (
    "/" +
    [
      ...imageSrc.split("/").slice(0, -1),
      ".resized_images",
      ...imageSrc.split("/").slice(-1),
    ].join("/") +
    "@800.avif"
  );
};
