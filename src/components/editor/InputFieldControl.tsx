import { Block, OnEditFn } from "../../services/types";

export const InputFieldControl: React.FC<{
  name: string;
  label: string;
  block: Block;
  currentIndex: number;
  edit: { onEdit: OnEditFn };
}> = (props) => {
  return (
    <label>
      <p>{props.label}</p>
      <textarea
        onChange={(ev) => {
          props.edit.onEdit(
            {
              ...props.block,
              data: { ...props.block.data, [props.name]: ev.target.value },
            },
            props.currentIndex,
          );
        }}
        // @ts-expect-error
        value={props.block.data?.[props.name] ?? ""}
      />
    </label>
  );
};
