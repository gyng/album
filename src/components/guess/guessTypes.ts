export type GuessPhoto = {
  path: string;
  lat: number;
  lng: number;
  geocode: string;
  albumName: string;
  photoName: string;
  /** "video" for a clip, where the index says; absent when it does not. */
  mediaKind?: string;
};

export type GameSettings = {
  rounds: number;
  timeLimit: number | null;
  region?: string;
  daily?: boolean;
  /** Archive paths dealt in this order, one per round, instead of a random draw. */
  photos?: string[];
};
