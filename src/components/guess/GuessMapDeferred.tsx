import { useClientComponents } from "../platform";
import type { GuessMapProps } from "./GuessMap";

export const GuessMapDeferred: React.FC<GuessMapProps> = (props) => {
  const { GuessMap } = useClientComponents();
  return <GuessMap {...props} />;
};
