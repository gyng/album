import { useClientComponents } from "./platform";
import type { PhotoSimilarPhotosProps } from "./platform/clientComponents";

export const PhotoSimilarPhotosDeferred: React.FC<PhotoSimilarPhotosProps> = (props) => {
  const { PhotoSimilarPhotos } = useClientComponents();
  return <PhotoSimilarPhotos {...props} />;
};
