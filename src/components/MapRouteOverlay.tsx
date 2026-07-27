import React from "react";
import { useMap } from "./map";
import type { RouteMode, RoutePoint } from "./mapRoute";
import {
  clipRouteSegmentsToViewport,
  formatDistanceKm,
  getAnimationSecondsFromSpeed,
  getDirectionalGradientStops,
  isRoutePointInViewport,
  isTransferLeg,
  projectGhostRoutePath,
  projectRouteSegments,
  selectPreferredLabelSegmentIds,
} from "./mapRouteOverlayModel";
import { THUMBNAIL_HIDE_ZOOM } from "./mapWorldViewModel";
import styles from "./MapWorld.module.css";

const useMapOverlayVersion = () => {
  const map = useMap();
  const [version, setVersion] = React.useState(0);

  React.useEffect(() => {
    if (!map) {
      return;
    }

    let frameId: number | null = null;
    const update = () => {
      if (typeof requestAnimationFrame !== "function") {
        setVersion((current) => current + 1);
        return;
      }

      if (frameId !== null) {
        return;
      }

      frameId = requestAnimationFrame(() => {
        frameId = null;
        setVersion((current) => current + 1);
      });
    };

    update();
    const unsubscribes = [map.on("move", update), map.on("zoom", update), map.on("resize", update)];

    return () => {
      if (frameId !== null) {
        cancelAnimationFrame(frameId);
      }
      unsubscribes.forEach((unsubscribe) => {
        unsubscribe();
      });
    };
  }, [map]);

  return { map, version };
};

export const MapRouteOverlay = ({
  routePoints,
  routeMode,
  getPointColor,
  showSpeedLabels,
  ghostRoutePoints,
}: {
  routePoints: RoutePoint[] | null;
  routeMode: RouteMode;
  getPointColor: (point: RoutePoint, index: number) => string;
  showSpeedLabels: boolean;
  ghostRoutePoints: RoutePoint[] | null;
}) => {
  const { map, version } = useMapOverlayVersion();

  const projectedSegments = React.useMemo(() => {
    void version;

    if (!map || !routePoints || routePoints.length < 2) {
      return [];
    }

    return projectRouteSegments(
      routePoints,
      ([lng, lat]) => map.project({ lng, lat }),
      getPointColor,
    );
  }, [getPointColor, map, routePoints, version]);

  const routeGradient = React.useMemo(() => {
    if (!routePoints || routePoints.length < 2 || projectedSegments.length === 0) {
      return null;
    }

    const startPoint = routePoints[0];
    const endPoint = routePoints.at(-1);
    const firstSegment = projectedSegments[0];
    const lastSegment = projectedSegments.at(-1);

    return {
      id: "journey-line-route-gradient",
      x1: firstSegment!.startX,
      y1: firstSegment!.startY,
      x2: lastSegment!.endX,
      y2: lastSegment!.endY,
      stops: getDirectionalGradientStops(
        getPointColor(startPoint!, 0),
        getPointColor(endPoint!, routePoints.length - 1),
      ),
    };
  }, [getPointColor, projectedSegments, routePoints]);

  const routeViewport = React.useMemo(() => {
    void version;

    if (!map) {
      return { width: 0, height: 0 };
    }

    const container = map.getContainer();
    return {
      width: container.clientWidth,
      height: container.clientHeight,
    };
  }, [map, version]);

  const visibleProjectedSegments = React.useMemo(
    () => clipRouteSegmentsToViewport(projectedSegments, routeViewport),
    [projectedSegments, routeViewport],
  );

  const projectedGhostPath = React.useMemo(() => {
    void version;

    if (!map || !ghostRoutePoints || ghostRoutePoints.length < 2) {
      return null;
    }

    return projectGhostRoutePath(ghostRoutePoints, ([lng, lat]) => map.project({ lng, lat }));
  }, [ghostRoutePoints, map, version]);

  const preferredLabelSegmentIds = React.useMemo(
    () => selectPreferredLabelSegmentIds(visibleProjectedSegments),
    [visibleProjectedSegments],
  );
  // Firefox repaints every animated dash across the route's screen-space
  // length. Once the thumbnail marker zoom is reached, a long journey can be
  // thousands of pixels wide even after off-screen legs are culled. The
  // static dashes, gradient, labels and endpoint flags still communicate the
  // route. Reserve marching motion for the overview where it stays cheap; at
  // thumbnail zoom, animate one small tracer per clipped on-screen leg instead.
  const animateMarchingDashes = map ? map.getZoom() < THUMBNAIL_HIDE_ZOOM : false;
  const endpointPingClass = [
    styles.routeEndpointPing,
    animateMarchingDashes ? styles.routeEndpointPingAnimated : "",
  ]
    .filter(Boolean)
    .join(" ");
  const delayedEndpointPingClass = [endpointPingClass, styles.routeEndpointPingDelay].join(" ");

  if (projectedSegments.length === 0 || visibleProjectedSegments.length === 0) {
    return null;
  }

  // Projection can discard individual invalid legs, but any surviving segment
  // proves the source route has endpoints and gives us concrete SVG anchors.
  const firstProjectedSegment = projectedSegments[0]!;
  const lastProjectedSegment = projectedSegments.at(-1)!;
  const startRoutePoint = routePoints![0]!;
  const endRoutePoint = routePoints!.at(-1)!;
  const showStartEndpoint = isRoutePointInViewport(
    { x: firstProjectedSegment.startX, y: firstProjectedSegment.startY },
    routeViewport,
  );
  const showEndEndpoint = isRoutePointInViewport(
    { x: lastProjectedSegment.endX, y: lastProjectedSegment.endY },
    routeViewport,
  );

  return (
    <svg
      className={styles.routeOverlay}
      data-testid="journey-line-overlay"
      aria-hidden="true"
      overflow="hidden"
    >
      <defs>
        <linearGradient
          id={routeGradient!.id}
          gradientUnits="userSpaceOnUse"
          x1={routeGradient!.x1}
          y1={routeGradient!.y1}
          x2={routeGradient!.x2}
          y2={routeGradient!.y2}
        >
          {routeGradient!.stops.map((stop) => (
            <stop
              key={`${routeGradient!.id}-${stop.offset}`}
              offset={stop.offset}
              stopColor={stop.color}
            />
          ))}
        </linearGradient>
      </defs>
      {projectedGhostPath ? (
        <path
          d={projectedGhostPath}
          className={styles.routeOverlayGhost}
          data-testid="journey-line-ghost-route"
          style={{
            strokeWidth: routeMode === "simplified" ? 3 : 2.5,
            strokeDasharray: "2 8",
          }}
        />
      ) : null}
      {visibleProjectedSegments.map((segment) => (
        <React.Fragment key={segment.id}>
          {(() => {
            const transferLeg = isTransferLeg(segment.distanceKm, segment.durationSeconds);
            const dashCycle = transferLeg ? 28 : 16;

            return (
              <>
                <path
                  d={segment.d}
                  className={styles.routeOverlayPathCasing}
                  style={{
                    strokeWidth: (routeMode === "simplified" ? 4 : 3) + 2,
                    opacity: 0.64,
                  }}
                />
                <path
                  d={segment.d}
                  className={[
                    styles.routeOverlayPath,
                    animateMarchingDashes ? styles.routeOverlayPathAnimated : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  data-testid="journey-line-segment"
                  style={{
                    stroke: `url(#${routeGradient!.id})`,
                    strokeWidth:
                      routeMode === "simplified"
                        ? transferLeg
                          ? 4.8
                          : 3.6
                        : transferLeg
                          ? 3.8
                          : 2.7,
                    opacity:
                      routeMode === "simplified"
                        ? transferLeg
                          ? 0.94
                          : 0.82
                        : transferLeg
                          ? 0.9
                          : 0.72,
                    strokeDasharray: transferLeg ? "18 10" : "8 8",
                    ["--route-speed" as string]: `${getAnimationSecondsFromSpeed(segment.approxSpeedKmh)}s`,
                    ["--route-dash-cycle" as string]: dashCycle,
                  }}
                />
                {showSpeedLabels &&
                preferredLabelSegmentIds.has(segment.id) &&
                segment.approxSpeedKmh !== null &&
                (segment.distanceKm >= 5 || segment.lengthPx >= 24) ? (
                  <g
                    className={styles.routeOverlaySpeedLabel}
                    data-testid="journey-line-speed-label"
                    transform={`translate(${segment.midX} ${segment.midY}) rotate(${segment.angle})`}
                  >
                    <text className={styles.routeOverlayLabel}>
                      {`${segment.approxSpeedKmh}km/h · ${formatDistanceKm(segment.distanceKm)}`}
                    </text>
                  </g>
                ) : null}
                {!animateMarchingDashes ? (
                  <circle
                    r="3"
                    className={styles.routeOverlayTracer}
                    data-testid="journey-line-tracer"
                    style={{ fill: segment.color }}
                  >
                    <animateMotion
                      path={segment.d}
                      dur={`${getAnimationSecondsFromSpeed(segment.approxSpeedKmh)}s`}
                      repeatCount="indefinite"
                    />
                  </circle>
                ) : null}
              </>
            );
          })()}
        </React.Fragment>
      ))}
      <>
        {/* ping rings rendered beneath the flag groups so they don't inherit the drop-shadow */}
        {(() => {
          const startColor = getPointColor(startRoutePoint, 0);
          const endColor = getPointColor(endRoutePoint, routePoints!.length - 1);
          return (
            <>
              {showStartEndpoint ? (
                <g
                  transform={`translate(${firstProjectedSegment.startX}, ${firstProjectedSegment.startY})`}
                >
                  <circle
                    cx="0"
                    cy="0"
                    r="3.5"
                    style={{ fill: startColor }}
                    className={endpointPingClass}
                  />
                  <circle
                    cx="0"
                    cy="0"
                    r="3.5"
                    style={{ fill: startColor }}
                    className={delayedEndpointPingClass}
                  />
                </g>
              ) : null}
              {showEndEndpoint ? (
                <g
                  transform={`translate(${lastProjectedSegment.endX}, ${lastProjectedSegment.endY})`}
                >
                  <circle
                    cx="0"
                    cy="0"
                    r="3.5"
                    style={{ fill: endColor }}
                    className={endpointPingClass}
                  />
                  <circle
                    cx="0"
                    cy="0"
                    r="3.5"
                    style={{ fill: endColor }}
                    className={delayedEndpointPingClass}
                  />
                </g>
              ) : null}
            </>
          );
        })()}
        {showStartEndpoint ? (
          <g
            data-testid="journey-line-start"
            className={styles.routeEndpointGroup}
            transform={`translate(${firstProjectedSegment.startX}, ${firstProjectedSegment.startY})`}
          >
            <line x1="0" y1="0" x2="0" y2="-24" className={styles.routeEndpointPole} />
            <polygon points="0,-24 14,-17 0,-10" className={styles.routeEndpointStartFlag} />
            <circle cx="0" cy="0" r="3.5" className={styles.routeEndpointBase} />
          </g>
        ) : null}
        {showEndEndpoint ? (
          <g
            data-testid="journey-line-end"
            className={styles.routeEndpointGroup}
            transform={`translate(${lastProjectedSegment.endX}, ${lastProjectedSegment.endY})`}
          >
            <line x1="0" y1="0" x2="0" y2="-24" className={styles.routeEndpointPole} />
            <rect x="0" y="-24" width="6" height="6" className={styles.routeEndpointCheckDark} />
            <rect x="6" y="-24" width="6" height="6" className={styles.routeEndpointCheckLight} />
            <rect x="0" y="-18" width="6" height="6" className={styles.routeEndpointCheckLight} />
            <rect x="6" y="-18" width="6" height="6" className={styles.routeEndpointCheckDark} />
            <circle cx="0" cy="0" r="3.5" className={styles.routeEndpointBase} />
          </g>
        ) : null}
      </>
    </svg>
  );
};
