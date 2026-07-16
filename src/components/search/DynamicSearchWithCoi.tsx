import { useClientComponents } from "../platform";
import type { SearchWithCoiProps } from "../platform/clientComponents";

const DynamicSearchWithCoi: React.FC<SearchWithCoiProps> = (props) => {
  const { SearchWithCoi } = useClientComponents();
  return <SearchWithCoi {...props} />;
};

export default DynamicSearchWithCoi;
