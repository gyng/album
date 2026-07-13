const MIDDLE_DRAG_BEARING_DEGREES_PER_PIXEL = 0.35;
const MIDDLE_DRAG_PITCH_DEGREES_PER_PIXEL = 0.25;
const MAX_MAP_PITCH = 60;

export const getMiddleDragCamera = ({
  startBearing,
  startPitch,
  deltaX,
  deltaY,
}: {
  startBearing: number;
  startPitch: number;
  deltaX: number;
  deltaY: number;
}): { bearing: number; pitch: number } => ({
  bearing: startBearing + deltaX * MIDDLE_DRAG_BEARING_DEGREES_PER_PIXEL,
  pitch: Math.min(
    MAX_MAP_PITCH,
    Math.max(0, startPitch - deltaY * MIDDLE_DRAG_PITCH_DEGREES_PER_PIXEL),
  ),
});

export const buildExternalMapLinks = (
  latitude: number,
  longitude: number,
): { google: string; osm: string } => ({
  google: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${latitude},${longitude}`)}`,
  osm: `https://www.openstreetmap.org/?mlat=${latitude}&mlon=${longitude}&zoom=13`,
});
