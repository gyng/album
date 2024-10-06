import { OnDeleteFn, OnEditFn } from "../../services/types";

export type DeleteBlockOptions = {
  isEditing: boolean;
  onEdit: OnEditFn;
};

export const DeleteBlock: React.FC<{
  currentIndex: number;
  edit: { onDelete: OnDeleteFn };
}> = (props) => {
  return (
    <label>
      <p>Deletion</p>
      <button
        onClick={async () => {
          const confirm = window.confirm(
            "Are you sure you want to delete this block?",
          );
          if (confirm) {
            props.edit.onDelete(props.currentIndex);
          }
        }}
      >
        Delete
      </button>
    </label>
  );
};
