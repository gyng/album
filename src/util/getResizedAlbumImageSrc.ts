import { encodePublicAssetPath } from "./encodePublicAssetPath";

export const getResizedAlbumImageSrc = (path: string): string => {
  const imageSrc = path.replace("..", "data");
  return encodePublicAssetPath(
    "/" +
      [
        ...imageSrc.split("/").slice(0, -1),
        ".resized_images",
        ...imageSrc.split("/").slice(-1),
      ].join("/") +
      "@800.avif",
  );
};
