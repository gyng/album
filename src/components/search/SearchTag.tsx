import React from "react";
import { SearchFilterPill } from "./SearchFilterPill";

interface SearchTagProps {
  tag: string;
  count: number;
  isActive?: boolean;
  disabled?: boolean;
  onClick: (tag: string, isActive: boolean) => void;
}

export const SearchTag = React.memo(function SearchTag({
  tag,
  count,
  onClick,
  isActive,
  disabled,
}: SearchTagProps) {
  const tagName = tag.toLocaleLowerCase();
  return (
    <SearchFilterPill
      label={tagName}
      count={count}
      isActive={isActive}
      disabled={disabled}
      onClick={() => onClick(tag, Boolean(isActive))}
    />
  );
});
