type SlideshowTapBounds = {
  left: number;
  width: number;
};

export const getSlideshowTouchTapAction = ({
  clientX,
  bounds,
  canGoPrevious,
}: {
  clientX: number;
  bounds: SlideshowTapBounds;
  canGoPrevious: boolean;
}): "next" | "previous" => {
  const tapOffsetX = clientX - bounds.left;
  const tappedPreviousZone =
    bounds.width > 0 && tapOffsetX < bounds.width * 0.35;

  return tappedPreviousZone && canGoPrevious ? "previous" : "next";
};

export type SlideshowOverlayPreset = {
  showDetails: boolean;
  showMap: boolean;
  showClock: boolean;
};

export const getNextSlideshowOverlayPreset = ({
  showDetails,
  showMap,
  showClock,
}: SlideshowOverlayPreset): SlideshowOverlayPreset => {
  if (!showDetails && !showMap && !showClock) {
    return {
      showDetails: true,
      showMap: false,
      showClock: false,
    };
  }

  if (showDetails && !showMap && !showClock) {
    return {
      showDetails: true,
      showMap: true,
      showClock: false,
    };
  }

  if (showDetails && showMap && !showClock) {
    return {
      showDetails: true,
      showMap: true,
      showClock: true,
    };
  }

  return {
    showDetails: false,
    showMap: false,
    showClock: false,
  };
};
