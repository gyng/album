import React from "react";
import { SearchFilterPill } from "./SearchFilterPill";

interface SearchTagProps {
  tag: string;
  count: number;
  isActive?: boolean;
  disabled?: boolean;
  onClick: (tag: string) => void;
}

export const SearchTag: React.FC<SearchTagProps> = ({
  tag,
  count,
  onClick,
  isActive,
  disabled,
}) => {
  const tagName = tag.toLocaleLowerCase();
  return (
    <SearchFilterPill
      label={tagName}
      count={count}
      isActive={isActive}
      disabled={disabled}
      onClick={() => onClick(tagName)}
    />
  );
};
