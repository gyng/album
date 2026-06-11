import dynamic from "next/dynamic";
import { MapProps } from "./Map";
import styles from "./Map.module.css";

const Map = dynamic(() => import("./Map"), {
  loading: () => <p className={styles.loadingPlaceholder}>Loading map&hellip;</p>,
  ssr: false,
});

export const MapDeferred: React.FC<MapProps> = (props) => {
  return <Map {...props} />;
};
