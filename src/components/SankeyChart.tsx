import { ResponsiveSankey } from "@nivo/sankey";
import { SankeyFlow } from "../util/computeStats";
import styles from "./SankeyChart.module.css";

type Props = {
  flow: SankeyFlow;
  emptyMessage?: string;
  labelMaxLength?: number;
  minHeight?: number;
  minLabelHeight?: number;
};

type SankeyChartNode = {
  id: string;
  label: string;
  displayLabel?: string;
  count: number;
  depth: number;
  facetId?: string;
  facetValue?: string;
  color?: string;
};

type SankeyChartLink = {
  source: string;
  target: string;
  value: number;
};

const truncateLabel = (label: string, max = 28) =>
  label.length > max ? `${label.slice(0, max - 1)}…` : label;

const buildFacetHref = (facetId?: string, facetValue?: string) =>
  facetId && facetValue
    ? `/search?facet=${encodeURIComponent(`${facetId}:${facetValue}`)}`
    : null;

const getNodeLabel = (node: any): string =>
  node.data?.displayLabel ??
  node.data?.label ??
  node.displayLabel ??
  node.label ??
  node.id;
const getNodeDepth = (node: any): number => node.data?.depth ?? node.depth ?? 0;
const getNodeFacetId = (node: any): string | undefined => node.data?.facetId ?? node.facetId;
const getNodeFacetValue = (node: any): string | undefined =>
  node.data?.facetValue ?? node.facetValue;
const getNodeCount = (node: any): number =>
  Number(node.value ?? node.data?.count ?? node.count ?? 0);

const ClickableLabelLayer = ({
  nodes,
  labelMaxLength,
  minLabelHeight,
}: any) => {
  const maxDepth = Math.max(...nodes.map((node: any) => getNodeDepth(node)), 0);

  return (
    <g>
      {nodes.map((node: any) => {
        const height = node.y1 - node.y0;
        if (height < minLabelHeight) {
          return null;
        }

        const href = buildFacetHref(
          getNodeFacetId(node),
          getNodeFacetValue(node),
        );
        const depth = getNodeDepth(node);
        const isLeftColumn = depth === 0;
        const isRightColumn = depth === maxDepth;
        const x =
          isLeftColumn || !isRightColumn ? node.x1 + 12 : node.x0 - 12;
        const y = node.y0 + (node.y1 - node.y0) / 2;
        const textAnchor =
          isLeftColumn || !isRightColumn ? "start" : "end";
        const label = truncateLabel(
          `${getNodeLabel(node)} · ${getNodeCount(node).toLocaleString()}`,
          labelMaxLength,
        );

        return (
          <a
            key={node.id}
            href={href ?? undefined}
            className={href ? styles.svgLabelLink : undefined}
          >
            <text
              x={x}
              y={y}
              textAnchor={textAnchor}
              dominantBaseline="central"
              className={styles.svgLabel}
            >
              {label}
            </text>
          </a>
        );
      })}
    </g>
  );
};

const chartTheme = {
  text: {
    fill: "var(--c-font)",
    fontSize: 12,
  },
  tooltip: {
    container: {
      background: "var(--c-bg)",
      color: "var(--c-font)",
      fontSize: 11,
      border: "1px solid var(--c-bg-contrast-dark)",
      borderRadius: 6,
      padding: "6px 8px",
      boxShadow: "none",
    },
  },
  grid: {
    line: {
      stroke: "transparent",
    },
  },
};

const FALLBACK_SPACING = 12;
const SANKEY_PALETTE = [
  "#e62065",
  "#ef4c8a",
  "#d94f7d",
  "#f06d9d",
  "#c7356f",
  "#f28bb1",
  "#b82b60",
  "#f5a7c7",
];

const hexToRgb = (hex: string): [number, number, number] => {
  const normalized = hex.replace("#", "");
  const value =
    normalized.length === 3
      ? normalized
          .split("")
          .map((char) => `${char}${char}`)
          .join("")
      : normalized;

  return [
    Number.parseInt(value.slice(0, 2), 16),
    Number.parseInt(value.slice(2, 4), 16),
    Number.parseInt(value.slice(4, 6), 16),
  ];
};

const rgbToHex = (rgb: [number, number, number]): string =>
  `#${rgb
    .map((channel) =>
      Math.max(0, Math.min(255, Math.round(channel)))
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;

const mixHex = (base: string, target: string, amount: number): string => {
  const baseRgb = hexToRgb(base);
  const targetRgb = hexToRgb(target);
  return rgbToHex([
    baseRgb[0] + (targetRgb[0] - baseRgb[0]) * amount,
    baseRgb[1] + (targetRgb[1] - baseRgb[1]) * amount,
    baseRgb[2] + (targetRgb[2] - baseRgb[2]) * amount,
  ]);
};

const readCssSpacing = (name: string, fallback: number): number => {
  if (typeof window === "undefined") {
    return fallback;
  }

  const raw = getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim();
  const parsed = Number.parseFloat(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const withFlowColors = (flow: SankeyFlow): {
  nodes: SankeyChartNode[];
  links: SankeyChartLink[];
} => {
  const rootNodes = flow.nodes
    .filter((node) => node.depth === 0)
    .sort((left, right) => right.count - left.count || left.id.localeCompare(right.id));

  const colorByRootId = new Map<string, string>();
  rootNodes.forEach((node, index) => {
    colorByRootId.set(node.id, SANKEY_PALETTE[index % SANKEY_PALETTE.length]);
  });

  const sourceLinksByTarget = new Map<string, typeof flow.links>();
  flow.links.forEach((link) => {
    const existing = sourceLinksByTarget.get(link.target) ?? [];
    existing.push(link);
    sourceLinksByTarget.set(link.target, existing);
  });

  const rootIdByNodeId = new Map<string, string>();
  rootNodes.forEach((node) => {
    rootIdByNodeId.set(node.id, node.id);
  });

  const sortedNodes = [...flow.nodes].sort(
    (left, right) => left.depth - right.depth || left.id.localeCompare(right.id),
  );

  sortedNodes.forEach((node) => {
    if (node.depth === 0) {
      return;
    }

    const incoming = (sourceLinksByTarget.get(node.id) ?? []).sort(
      (left, right) => right.count - left.count || left.source.localeCompare(right.source),
    );
    const strongestSource = incoming[0]?.source;
    if (!strongestSource) {
      return;
    }

    rootIdByNodeId.set(
      node.id,
      rootIdByNodeId.get(strongestSource) ?? strongestSource,
    );
  });

  const nodes = flow.nodes.map((node) => {
    const rootId = rootIdByNodeId.get(node.id) ?? node.id;
    const baseColor = colorByRootId.get(rootId) ?? SANKEY_PALETTE[0];
    const depth = Math.max(0, node.depth);
    const depthTint = Math.min(0.18, depth * 0.06);
    return {
      ...node,
      color: mixHex(baseColor, "#ffffff", depthTint),
    };
  });

  return {
    nodes,
    links: flow.links.map((link) => ({
      source: link.source,
      target: link.target,
      value: link.count,
    })),
  };
};

export const SankeyChart: React.FC<Props> = ({
  flow,
  emptyMessage = "Not enough linked data yet.",
  labelMaxLength = 28,
  minHeight = 460,
  minLabelHeight = 14,
}) => {
  const spacing = readCssSpacing("--m-s", FALLBACK_SPACING);

  if (flow.nodes.length === 0 || flow.links.length === 0) {
    return <p className={styles.empty}>{emptyMessage}</p>;
  }

  const chartData = withFlowColors(flow);

  return (
    <div className={styles.wrapper}>
      <div
        className={styles.chartShell}
        style={{ ["--sankey-height" as string]: `${minHeight}px` }}
      >
        <ResponsiveSankey<SankeyChartNode, SankeyChartLink>
          data={chartData}
          margin={{
            top: spacing,
            right: spacing * 7,
            bottom: spacing,
            left: spacing * 7,
          }}
          align="justify"
          sort="descending"
          colors={(node) =>
            (node as { data?: { color?: string }; color?: string }).data?.color ??
            (node as { data?: { color?: string }; color?: string }).color ??
            SANKEY_PALETTE[0]
          }
          nodeOpacity={0.9}
          nodeThickness={18}
          nodeSpacing={0}
          nodeBorderWidth={0}
          linkOpacity={0.28}
          nodeHoverOpacity={1}
          nodeHoverOthersOpacity={0.25}
          linkHoverOpacity={0.45}
          linkHoverOthersOpacity={0.08}
          enableLinkGradient
          enableLabels={false}
          animate={false}
          isInteractive
          layers={[
            "links",
            "nodes",
            (props) => (
              <ClickableLabelLayer
                {...props}
                labelMaxLength={labelMaxLength}
                minLabelHeight={minLabelHeight}
              />
            ),
          ]}
          theme={chartTheme}
          valueFormat={(value) => `${Number(value).toLocaleString()} photos`}
          nodeTooltip={({ node }) => (
            <div className={styles.tooltip}>
              <strong>{getNodeLabel(node)}</strong>
              <div>{Number(node.value).toLocaleString()} photos</div>
            </div>
          )}
          linkTooltip={({ link }) => (
            <div className={styles.tooltip}>
              <strong>
                {getNodeLabel(link.source)} to {getNodeLabel(link.target)}
              </strong>
              <div>{Number(link.value).toLocaleString()} photos</div>
            </div>
          )}
        />
      </div>
    </div>
  );
};
