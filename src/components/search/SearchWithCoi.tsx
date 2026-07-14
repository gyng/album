import Search, { type SearchNavState } from "./Search";

function SearchWithCoi({
  onNavStateChange,
}: {
  onNavStateChange?: (state: SearchNavState) => void;
}) {
  return (
    <>
      <Search disabled={false} {...(onNavStateChange ? { onNavStateChange } : {})} />
    </>
  );
}

export default SearchWithCoi;
