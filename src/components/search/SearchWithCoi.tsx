import React from "react";
import Search, { SearchNavState } from "./Search";

export const SearchWithCoi: React.FC<{
  onNavStateChange?: (state: SearchNavState) => void;
}> = ({ onNavStateChange }) => {
  return (
    <>
      <Search disabled={false} onNavStateChange={onNavStateChange} />
    </>
  );
};

export default SearchWithCoi;
