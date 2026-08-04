import type { EmbeddingSpaceProps } from "./EmbeddingSpace";
import { useClientComponents } from "./platform";

export const EmbeddingSpaceDeferred: React.FC<EmbeddingSpaceProps> = (props) => {
  const { EmbeddingSpace } = useClientComponents();
  return <EmbeddingSpace {...props} />;
};
