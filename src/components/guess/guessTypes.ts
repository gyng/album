export type GuessPhoto = {
  path: string;
  lat: number;
  lng: number;
  geocode: string;
  albumName: string;
  photoName: string;
};

export type GameSettings = {
  rounds: number;
  timeLimit: number | null;
  region?: string;
  daily?: boolean;
  /** Archive paths dealt in this order, one per round, instead of a random draw. */
  photos?: string[];
};
