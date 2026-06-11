import dynamic from "next/dynamic";
import { MapWorldProps } from "./MapWorld";
import styles from "./MapWorld.module.css";

const Map = dynamic(() => import("./MapWorld"), {
  loading: () => <p className={styles.loadingPlaceholder}>Loading map&hellip;</p>,
  ssr: false,
});

export const MapWorldDeferred: React.FC<MapWorldProps> = (props) => {
  return <Map {...props} />;
};
