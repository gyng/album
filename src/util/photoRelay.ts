import { relayLinkSimilarities, type PhotoGamePhoto } from "./photoGames";
import { PHOTO_SUBJECTS, photoSubjectClarity } from "./photoSubjects";

export type RelayLinkDescription = {
  from: number;
  to: number;
  similarity: number | null;
  subjects: string[];
};

// Captions and tags can support subject clues, but cannot explain the image
// embedding's actual decision or establish visual features such as contrast.
export const describeRelayLinks = (photos: PhotoGamePhoto[]): RelayLinkDescription[] => {
  const similarities = relayLinkSimilarities(photos);
  return photos.slice(0, -1).map((photo, index) => ({
    from: index + 1,
    to: index + 2,
    similarity: similarities[index] ?? null,
    subjects: PHOTO_SUBJECTS.filter(
      (subject) =>
        photoSubjectClarity(photo, subject.pattern) !== null &&
        photoSubjectClarity(photos[index + 1]!, subject.pattern) !== null,
    )
      .slice(0, 3)
      .map(({ answer }) => answer[0]! + answer.slice(1).toLowerCase()),
  }));
};
