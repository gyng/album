import styles from "./EmbeddingSpace.module.css";
import type { EmbeddingSpaceProps } from "./EmbeddingSpace";
import { useClientComponents } from "./platform";

/**
 * The cloud is a client-only component, so the page has nothing to put where it
 * will be until the browser gets there. The box the stage asks for is reserved
 * here from the first paint, so the cloud's arrival cannot move the page below
 * it. An explicit height travels the same way it does to the stage, through the
 * box's size property — see the stylesheet.
 */
export const EmbeddingSpaceDeferred: React.FC<EmbeddingSpaceProps> = ({ height, ...props }) => {
  const { EmbeddingSpace } = useClientComponents();
  return (
    <div
      className={styles.reservedBox}
      {...(height === undefined
        ? {}
        : { style: { ["--cloud-stage-block-size" as string]: `${height}px` } })}
    >
      <EmbeddingSpace {...(height !== undefined ? { height } : {})} {...props} />
    </div>
  );
};
