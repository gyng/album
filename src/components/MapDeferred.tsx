import dynamic from "next/dynamic";
import { MapProps } from "./Map";

const Map = dynamic(() => import("./Map"), {
  loading: () => <p>Loading map&hellip;</p>,
  ssr: false,
});

export const MapDeferred: React.FC<MapProps> = (props) => {
  return <Map {...props} />;
};
