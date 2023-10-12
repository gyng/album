import dynamic from "next/dynamic";
import React from "react";
import { MapWorldProps } from "./MapWorld";

export const MapWorldDeferred: React.FC<MapWorldProps> = (props) => {
  const Map = React.useMemo(
    () =>
      dynamic(() => import("./MapWorld"), {
        loading: () => <p></p>,
        ssr: false,
      }),
    []
  );
  return <Map {...props} />;
};
