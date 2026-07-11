declare module "tz-lookup" {
  /** Returns the IANA timezone name for a latitude/longitude. */
  const tzLookup: (lat: number, lng: number) => string;
  export default tzLookup;
}
