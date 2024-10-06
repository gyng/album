import dynamic from "next/dynamic";
import React from "react";
import { MapProps } from "./Map";

export const MapDeferred: React.FC<MapProps> = (props) => {
  const Map = React.useMemo(
    () =>
      dynamic(() => import("./Map"), {
        loading: () => <p>Loading map&hellip;</p>,
        ssr: false,
      }),
    [],
  );
  return <Map {...props} />;
};
