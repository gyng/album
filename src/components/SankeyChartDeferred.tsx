import type { SankeyChartProps } from "./SankeyChart";
import { useClientComponents } from "./platform";

export const SankeyChartDeferred: React.FC<SankeyChartProps> = (props) => {
  const { SankeyChart } = useClientComponents();
  return <SankeyChart {...props} />;
};
