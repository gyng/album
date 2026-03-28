import { OptimisedPhoto } from "../services/types";

export type TimelineEntry = {
  album: string;
  date: string;
  dateTimeOriginal: string;
  decLat?: number | null;
  decLng?: number | null;
  geocode?: string | null;
  src: OptimisedPhoto;
  href: string;
  path: string;
  placeholderColor: string;
  placeholderWidth: number;
  placeholderHeight: number;
};