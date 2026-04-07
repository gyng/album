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
};
