export type MobileDrawerEdge = "left" | "right";

const EDGE_START_WIDTH = 24;
const HORIZONTAL_INTENT_DISTANCE = 10;
const OPEN_DISTANCE = 56;
const HORIZONTAL_INTENT_RATIO = 1.25;

export type MobileDrawerGesture = {
  edge: MobileDrawerEdge;
  startX: number;
  startY: number;
};

export function beginMobileDrawerGesture(
  clientX: number,
  clientY: number,
  viewportWidth: number
): MobileDrawerGesture | null {
  if (clientX <= EDGE_START_WIDTH) return { edge: "left", startX: clientX, startY: clientY };
  if (clientX >= viewportWidth - EDGE_START_WIDTH) return { edge: "right", startX: clientX, startY: clientY };
  return null;
}

export function openedDrawerFromGesture(
  gesture: MobileDrawerGesture,
  clientX: number,
  clientY: number
): MobileDrawerEdge | null {
  const deltaX = clientX - gesture.startX;
  if (Math.abs(deltaX) < OPEN_DISTANCE) return null;
  return gestureHasInwardHorizontalIntent(gesture, clientX, clientY) ? gesture.edge : null;
}

export function gestureHasInwardHorizontalIntent(
  gesture: MobileDrawerGesture,
  clientX: number,
  clientY: number
): boolean {
  const deltaX = clientX - gesture.startX;
  const deltaY = clientY - gesture.startY;
  if (Math.abs(deltaX) < HORIZONTAL_INTENT_DISTANCE) return false;
  if (Math.abs(deltaX) <= Math.abs(deltaY) * HORIZONTAL_INTENT_RATIO) return false;
  return gesture.edge === "left" ? deltaX > 0 : deltaX < 0;
}

export function gestureBecameVertical(
  gesture: MobileDrawerGesture,
  clientX: number,
  clientY: number
): boolean {
  const deltaX = Math.abs(clientX - gesture.startX);
  const deltaY = Math.abs(clientY - gesture.startY);
  return deltaY > 12 && deltaY > deltaX;
}
