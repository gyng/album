import dynamic from "next/dynamic";
import { MapWorldProps } from "./MapWorld";

const Map = dynamic(() => import("./MapWorld"), {
  loading: () => <p></p>,
  ssr: false,
});

export const MapWorldDeferred: React.FC<MapWorldProps> = (props) => {
  return <Map {...props} />;
};
