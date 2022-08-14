import { v4 } from "uuid";
import { serializeTextBlock } from "../../api/serialize";
import { OnEditFn, TextBlock } from "../../api/types";

import editStyles from "../EditContainer.module.css";

export type BlockControlOptions = {
  isEditing: boolean;
  onEdit: OnEditFn;
};

export const BlockControl: React.FC<{
  currentIndex: number;
  edit: BlockControlOptions;
}> = (props) => {
  return (
    <div className={[editStyles.gridCenter, editStyles.small].join(" ")}>
      <div className={editStyles.editContainer}>
        <button
          onClick={async () => {
            const newBlock: TextBlock = {
              kind: "text",
              id: v4(),
              data: {
                title: "Title",
                kicker: "Kicker",
                description: "Description",
              },
            };
            props.edit.onEdit(serializeTextBlock(newBlock), props.currentIndex);
          }}
        >
          Add Text block
        </button>
      </div>
    </div>
  );
};
