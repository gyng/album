import { useEffect, useMemo, useRef, useState } from "react";
import { ParallelRelationshipData } from "../util/computeStats";
import { buildSearchHref } from "../util/searchFacets";
import styles from "./TechnicalHeatmaps.module.css";

type Props = {
  data: ParallelRelationshipData;
  pairs?: Array<[number, number]>;
  titles?: Record<string, string>;
  caption?: string;
  layout?: "stacked" | "two-up" | "diagonal" | "tri-grid";
  activeXAxisBucket?: string | null;
};

type HeatmapCell = {
  xLabel: string;
  yLabel: string;
  count: number;
};

type HeatmapConfig = {
  key: string;
  title: string;
  xAxis: number;
  yAxis: number;
  cells: HeatmapCell[];
};

type RelatedCell = {
  heatmapKey: string;
  cellKey: string;
  count: number;
};

type ActiveSelection = {
  heatmapKey: string;
  cellKey: string;
};

type OverlayLine = {
  key: string;
  d: string;
  width: number;
  opacity: number;
  label: string;
  labelX: number;
  labelY: number;
};

const cubicBezierPoint = (
  p0: number,
  p1: number,
  p2: number,
  p3: number,
  t: number,
): number => {
  const mt = 1 - t;
  return (
    mt * mt * mt * p0 +
    3 * mt * mt * t * p1 +
    3 * mt * t * t * p2 +
    t * t * t * p3
  );
};

const DEFAULT_PAIRS: Array<[number, number]> = [
  [0, 1],
  [0, 2],
  [1, 2],
];

const EMPTY_TITLES: Record<string, string> = {};

const buildCellKey = (xLabel: string, yLabel: string) =>
  `${xLabel}\u001f${yLabel}`;

const buildHeatmap = (
  data: ParallelRelationshipData,
  xAxis: number,
  yAxis: number,
  title: string,
): HeatmapConfig => {
  const counts = new Map<string, number>();

  data.paths.forEach((path) => {
    const xLabel = path.values[xAxis];
    const yLabel = path.values[yAxis];
    const key = buildCellKey(xLabel, yLabel);
    counts.set(key, (counts.get(key) ?? 0) + path.count);
  });

  return {
    key: `${xAxis}-${yAxis}`,
    title,
    xAxis,
    yAxis,
    cells: Array.from(counts.entries()).map(([key, count]) => {
      const [xLabel, yLabel] = key.split("\u001f");
      return { xLabel, yLabel, count };
    }),
  };
};

const buildRelationshipIndex = (
  data: ParallelRelationshipData,
  heatmaps: HeatmapConfig[],
) => {
  const index = new Map<string, Map<string, number>>();

  data.paths.forEach((path) => {
    heatmaps.forEach((source) => {
      const sourceCellKey = buildCellKey(
        path.values[source.xAxis],
        path.values[source.yAxis],
      );
      const sourceSelectionKey = `${source.key}::${sourceCellKey}`;
      const current = index.get(sourceSelectionKey) ?? new Map<string, number>();

      heatmaps.forEach((target) => {
        if (target.key === source.key) {
          return;
        }

        const targetCellKey = buildCellKey(
          path.values[target.xAxis],
          path.values[target.yAxis],
        );
        const targetSelectionKey = `${target.key}::${targetCellKey}`;
        current.set(
          targetSelectionKey,
          (current.get(targetSelectionKey) ?? 0) + path.count,
        );
      });

      index.set(sourceSelectionKey, current);
    });
  });

  return index;
};

const HeatmapPanel: React.FC<{
  data: ParallelRelationshipData;
  config: HeatmapConfig;
  className?: string;
  activeSelection: ActiveSelection | null;
  relatedKeys: Set<string>;
  onActivate: (selection: ActiveSelection) => void;
  onDeactivate: () => void;
  registerCell: (key: string, node: HTMLAnchorElement | null) => void;
  activeXAxisBucket?: string | null;
}> = ({
  data,
  config,
  className,
  activeSelection,
  relatedKeys,
  onActivate,
  onDeactivate,
  registerCell,
  activeXAxisBucket,
}) => {
  const xAxis = data.axes[config.xAxis];
  const yAxis = data.axes[config.yAxis];
  const max = Math.max(...config.cells.map((cell) => cell.count), 1);
  const hasActive = activeSelection !== null;
  const sparseXAxisLabels = xAxis.facetId === "hour" && xAxis.buckets.length >= 24;

  return (
    <section className={[styles.panel, className ?? ""].join(" ")}>
      <h3 className={styles.panelTitle}>{config.title}</h3>
      <div
        className={styles.matrix}
        style={{
          gridTemplateColumns: `120px repeat(${xAxis.buckets.length}, minmax(0, 1fr))`,
        }}
      >
        <div className={styles.corner} />
        {xAxis.buckets.map((bucket, index) => (
          <div
            key={`${config.title}-x-${bucket}`}
            className={[
              styles.columnLabel,
              activeXAxisBucket === bucket ? styles.columnLabelActive : "",
              sparseXAxisLabels && index % 2 === 1 ? styles.columnLabelMuted : "",
            ].join(" ")}
          >
            {sparseXAxisLabels && index % 2 === 1 ? "" : bucket}
          </div>
        ))}

        {yAxis.buckets.map((yBucket) => (
          <div key={`${config.title}-row-${yBucket}`} className={styles.row}>
            <div className={styles.rowLabel}>{yBucket}</div>
            {xAxis.buckets.map((xBucket) => {
              const cellKey = buildCellKey(xBucket, yBucket);
              const globalCellKey = `${config.key}::${cellKey}`;
              const cell =
                config.cells.find(
                  (item) => item.xLabel === xBucket && item.yLabel === yBucket,
                ) ?? null;
              const count = cell?.count ?? 0;
              const intensity = count > 0 ? count / max : 0;
              const href =
                count > 0
                  ? buildSearchHref({
                      facets: [
                        { facetId: xAxis.facetId, value: xBucket },
                        { facetId: yAxis.facetId, value: yBucket },
                      ],
                    })
                  : null;

              if (!href) {
                return (
                  <div
                    key={`${config.title}-${xBucket}-${yBucket}`}
                    className={`${styles.cell} ${styles.cellEmpty}`}
                    style={{ ["--intensity" as string]: "0" }}
                  />
                );
              }

              return (
                <a
                  key={`${config.title}-${xBucket}-${yBucket}`}
                  href={href}
                  ref={(node) => {
                    registerCell(globalCellKey, node);
                  }}
                  className={[
                    styles.cell,
                    activeXAxisBucket === xBucket ? styles.cellColumnActive : "",
                    hasActive && !relatedKeys.has(globalCellKey)
                      ? styles.cellDimmed
                      : "",
                    activeSelection?.heatmapKey === config.key &&
                    activeSelection.cellKey === cellKey
                      ? styles.cellActive
                      : "",
                    relatedKeys.has(globalCellKey) &&
                    !(
                      activeSelection?.heatmapKey === config.key &&
                      activeSelection.cellKey === cellKey
                    )
                      ? styles.cellRelated
                      : "",
                  ].join(" ")}
                  style={{ ["--intensity" as string]: String(intensity) }}
                  title={`${xBucket} · ${yBucket} · ${count.toLocaleString()} photos`}
                  onMouseEnter={() => {
                    onActivate({ heatmapKey: config.key, cellKey });
                  }}
                  onMouseLeave={onDeactivate}
                  onFocus={() => {
                    onActivate({ heatmapKey: config.key, cellKey });
                  }}
                  onBlur={onDeactivate}
                >
                  <span className={styles.cellCount}>{count.toLocaleString()}</span>
                </a>
              );
            })}
          </div>
        ))}
      </div>
    </section>
  );
};

export const TechnicalHeatmaps: React.FC<Props> = ({
  data,
  pairs,
  titles,
  caption = "Hover a square to trace the corresponding relationships across the other heatmaps, or click to open that pair in Search.",
  layout = "stacked",
  activeXAxisBucket = null,
}) => {
  const stablePairs = pairs ?? DEFAULT_PAIRS;
  const stableTitles = titles ?? EMPTY_TITLES;
  const heatmaps = useMemo(
    () =>
      stablePairs.map(([xAxis, yAxis]) =>
        buildHeatmap(
          data,
          xAxis,
          yAxis,
          stableTitles[`${xAxis}-${yAxis}`] ??
            `${data.axes[xAxis].label} × ${data.axes[yAxis].label}`,
        ),
      ),
    [data, stablePairs, stableTitles],
  );
  const relationshipIndex = useMemo(
    () => buildRelationshipIndex(data, heatmaps),
    [data, heatmaps],
  );
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const cellRefs = useRef(new Map<string, HTMLAnchorElement | null>());
  const [activeSelection, setActiveSelection] = useState<ActiveSelection | null>(
    null,
  );
  const [overlayLines, setOverlayLines] = useState<OverlayLine[]>([]);

  const relatedMap = useMemo(
    () =>
      activeSelection
        ? relationshipIndex.get(
            `${activeSelection.heatmapKey}::${activeSelection.cellKey}`,
          ) ?? new Map<string, number>()
        : new Map<string, number>(),
    [activeSelection, relationshipIndex],
  );

  const relatedKeys = useMemo(
    () =>
      new Set<string>(
        activeSelection
          ? [
              `${activeSelection.heatmapKey}::${activeSelection.cellKey}`,
              ...Array.from(relatedMap.keys()),
            ]
          : [],
      ),
    [activeSelection, relatedMap],
  );

  useEffect(() => {
    if (!activeSelection || !wrapperRef.current) {
      const frame = requestAnimationFrame(() => {
        setOverlayLines((current) => (current.length === 0 ? current : []));
      });
      return () => {
        cancelAnimationFrame(frame);
      };
    }

    let frame = 0;

    const updateLines = () => {
      frame = 0;
      const sourceNode = cellRefs.current.get(
        `${activeSelection.heatmapKey}::${activeSelection.cellKey}`,
      );
      const wrapperNode = wrapperRef.current;
      if (!sourceNode || !wrapperNode) {
        setOverlayLines((current) => (current.length === 0 ? current : []));
        return;
      }

      const sourceRect = sourceNode.getBoundingClientRect();
      const wrapperRect = wrapperNode.getBoundingClientRect();
      const source = {
        x: sourceRect.left + sourceRect.width / 2 - wrapperRect.left,
        y: sourceRect.top + sourceRect.height / 2 - wrapperRect.top,
      };
      const maxCount = Math.max(...Array.from(relatedMap.values()), 1);

      setOverlayLines(
        Array.from(relatedMap.entries()).flatMap(([targetKey, count]) => {
          const targetNode = cellRefs.current.get(targetKey);
          if (!targetNode) {
            return [];
          }

          const targetRect = targetNode.getBoundingClientRect();
          const target = {
            x: targetRect.left + targetRect.width / 2 - wrapperRect.left,
            y: targetRect.top + targetRect.height / 2 - wrapperRect.top,
          };
          const midX = source.x + (target.x - source.x) * 0.45;
          const labelT = 0.56;
          const labelX = cubicBezierPoint(
            source.x,
            midX,
            midX,
            target.x,
            labelT,
          );
          const labelY = cubicBezierPoint(
            source.y,
            source.y,
            target.y,
            target.y,
            labelT,
          );
          return [
            {
              key: `${activeSelection.heatmapKey}-${targetKey}`,
              d: `M ${source.x} ${source.y} C ${midX} ${source.y}, ${midX} ${target.y}, ${target.x} ${target.y}`,
              width: 1.5 + (count / maxCount) * 5,
              opacity: 0.18 + (count / maxCount) * 0.55,
              label: count.toLocaleString(),
              labelX,
              labelY,
            },
          ];
        }),
      );
    };

    const scheduleUpdate = () => {
      if (frame !== 0) {
        cancelAnimationFrame(frame);
      }
      frame = requestAnimationFrame(updateLines);
    };

    scheduleUpdate();
    window.addEventListener("resize", scheduleUpdate);
    return () => {
      if (frame !== 0) {
        cancelAnimationFrame(frame);
      }
      window.removeEventListener("resize", scheduleUpdate);
    };
  }, [activeSelection, relatedMap]);

  return (
    <div
      ref={wrapperRef}
      className={[
        styles.wrapper,
        layout === "two-up" ? styles.wrapperTwoUp : "",
        layout === "diagonal" ? styles.wrapperDiagonal : "",
        layout === "tri-grid" ? styles.wrapperTriGrid : "",
      ].join(" ")}
    >
      {overlayLines.length > 0 ? (
        <svg className={styles.overlay} aria-hidden="true">
          {overlayLines.map((line) => (
            <g key={line.key}>
              <path
                d={line.d}
                className={styles.overlayLine}
                style={{
                  strokeWidth: `${line.width}px`,
                  opacity: line.opacity,
                }}
              />
              <g
                className={styles.overlayLabel}
                transform={`translate(${line.labelX}, ${line.labelY})`}
                style={{ opacity: Math.max(0.45, line.opacity) }}
              >
                <rect
                  x={-18}
                  y={-9}
                  width={36}
                  height={18}
                  rx={9}
                  className={styles.overlayLabelBg}
                />
                <text textAnchor="middle" dominantBaseline="central">
                  {line.label}
                </text>
              </g>
            </g>
          ))}
        </svg>
      ) : null}
      {layout === "diagonal" && heatmaps.length === 2 ? (
        <>
          <HeatmapPanel
            key={heatmaps[0].title}
            className={styles.panelTopLeft}
            data={data}
            config={heatmaps[0]}
            activeSelection={activeSelection}
            relatedKeys={relatedKeys}
            onActivate={setActiveSelection}
            onDeactivate={() => {
              setActiveSelection(null);
            }}
            registerCell={(key, node) => {
              if (node) {
                cellRefs.current.set(key, node);
                return;
              }

              cellRefs.current.delete(key);
            }}
            activeXAxisBucket={activeXAxisBucket}
          />
          <div className={styles.diagonalSpacer} aria-hidden="true" />
          <div className={styles.diagonalSpacer} aria-hidden="true" />
          <HeatmapPanel
            key={heatmaps[1].title}
            className={styles.panelBottomRight}
            data={data}
            config={heatmaps[1]}
            activeSelection={activeSelection}
            relatedKeys={relatedKeys}
            onActivate={setActiveSelection}
            onDeactivate={() => {
              setActiveSelection(null);
            }}
            registerCell={(key, node) => {
              if (node) {
                cellRefs.current.set(key, node);
                return;
              }

              cellRefs.current.delete(key);
            }}
            activeXAxisBucket={activeXAxisBucket}
          />
        </>
      ) : layout === "tri-grid" && heatmaps.length === 3 ? (
        <>
          <HeatmapPanel
            key={heatmaps[0].title}
            className={styles.panelTopLeft}
            data={data}
            config={heatmaps[0]}
            activeSelection={activeSelection}
            relatedKeys={relatedKeys}
            onActivate={setActiveSelection}
            onDeactivate={() => {
              setActiveSelection(null);
            }}
            registerCell={(key, node) => {
              if (node) {
                cellRefs.current.set(key, node);
                return;
              }

              cellRefs.current.delete(key);
            }}
            activeXAxisBucket={activeXAxisBucket}
          />
          <HeatmapPanel
            key={heatmaps[1].title}
            className={styles.panelTopRight}
            data={data}
            config={heatmaps[1]}
            activeSelection={activeSelection}
            relatedKeys={relatedKeys}
            onActivate={setActiveSelection}
            onDeactivate={() => {
              setActiveSelection(null);
            }}
            registerCell={(key, node) => {
              if (node) {
                cellRefs.current.set(key, node);
                return;
              }

              cellRefs.current.delete(key);
            }}
            activeXAxisBucket={activeXAxisBucket}
          />
          <HeatmapPanel
            key={heatmaps[2].title}
            className={styles.panelBottomLeft}
            data={data}
            config={heatmaps[2]}
            activeSelection={activeSelection}
            relatedKeys={relatedKeys}
            onActivate={setActiveSelection}
            onDeactivate={() => {
              setActiveSelection(null);
            }}
            registerCell={(key, node) => {
              if (node) {
                cellRefs.current.set(key, node);
                return;
              }

              cellRefs.current.delete(key);
            }}
            activeXAxisBucket={activeXAxisBucket}
          />
          <div className={styles.triSpacer} aria-hidden="true" />
        </>
      ) : (
        heatmaps.map((heatmap) => (
          <HeatmapPanel
            key={heatmap.title}
            data={data}
            config={heatmap}
            activeSelection={activeSelection}
            relatedKeys={relatedKeys}
            onActivate={setActiveSelection}
            onDeactivate={() => {
              setActiveSelection(null);
            }}
            registerCell={(key, node) => {
              if (node) {
                cellRefs.current.set(key, node);
                return;
              }

              cellRefs.current.delete(key);
            }}
            activeXAxisBucket={activeXAxisBucket}
          />
        ))
      )}
      <p className={styles.caption}>
        {caption}
      </p>
    </div>
  );
};
