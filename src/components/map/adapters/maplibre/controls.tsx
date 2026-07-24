import React from "react";
import { gl } from "./engine";
import type {
  AttributionControlOptions,
  ControlPosition,
  FullscreenControlOptions,
  GeolocateControlOptions,
  IControl,
  NavigationControlOptions,
  ScaleControlOptions,
} from "./engine";
import { useAttachedMap } from "./context";
import { useLatestRef } from "./internal";

type ControlPlacement = { position?: ControlPosition };

const useMapControl = (create: () => IControl, position: ControlPosition | undefined): null => {
  // Written from an effect, not during render: the factory closes over the
  // caller's props, and a render React abandons must not be able to hand the
  // map a control built from options that were never committed.
  const createRef = useLatestRef(create);
  const map = useAttachedMap();

  React.useEffect(() => {
    if (!map) {
      return;
    }

    const control = createRef.current();
    if (!map.hasControl(control)) {
      map.addControl(control, position);
    }

    return () => {
      // The map may already be gone: React destroys parent effects first.
      if (map.hasControl(control)) {
        map.removeControl(control);
      }
    };
  }, [map, position, createRef]);

  return null;
};

export type NavigationControlProps = NavigationControlOptions & ControlPlacement;

export const NavigationControl = (props: NavigationControlProps): null =>
  useMapControl(() => new gl.NavigationControl(props), props.position);

export type GeolocateControlProps = GeolocateControlOptions & ControlPlacement;

export const GeolocateControl = (props: GeolocateControlProps): null =>
  useMapControl(() => new gl.GeolocateControl(props), props.position);

export type ScaleControlProps = ScaleControlOptions & ControlPlacement;

export const ScaleControl = (props: ScaleControlProps): null =>
  useMapControl(() => new gl.ScaleControl(props), props.position);

export type FullscreenControlProps = FullscreenControlOptions & ControlPlacement;

export const FullscreenControl = (props: FullscreenControlProps): null =>
  useMapControl(() => new gl.FullscreenControl(props), props.position);

export type AttributionControlProps = AttributionControlOptions & ControlPlacement;

export const AttributionControl = (props: AttributionControlProps): null =>
  useMapControl(() => new gl.AttributionControl(props), props.position);
