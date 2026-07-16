import type { MapWorldProps } from "./MapWorld";
import { MapLibreStyles } from "./MapLibreStyles";
import { useClientComponents } from "./platform";

export const MapWorldDeferred: React.FC<MapWorldProps> = (props) => {
  const { MapWorld } = useClientComponents();
  return (
    <>
      <MapLibreStyles />
      <MapWorld {...props} />
    </>
  );
};
