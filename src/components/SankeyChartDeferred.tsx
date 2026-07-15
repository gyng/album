import dynamic from "next/dynamic";
import type { SankeyChartProps } from "./SankeyChart";

const DeferredSankeyChart = dynamic(
  () => import("./SankeyChart").then((module) => module.SankeyChart),
  { ssr: false },
);

export const SankeyChartDeferred: React.FC<SankeyChartProps> = (props) => (
  <DeferredSankeyChart {...props} />
);
