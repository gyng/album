import { MapProps } from "./Map";
import { MapLibreStyles } from "./MapLibreStyles";
import { useClientComponents } from "./platform";

export const MapDeferred: React.FC<MapProps> = (props) => {
  const { Map } = useClientComponents();
  return (
    <>
      <MapLibreStyles />
      <Map {...props} />
    </>
  );
};
