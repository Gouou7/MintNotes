import { useEffect, useRef } from "react";
import { touchPinRefreshGrant } from "../../crypto/deviceUnlock";
import {
  beginMobileDrawerGesture,
  gestureBecameVertical,
  gestureHasInwardHorizontalIntent,
  openedDrawerFromGesture,
  type MobileDrawerGesture
} from "../mobileDrawerGesture";

const ACTIVITY_EVENTS = ["pointermove", "pointerdown", "keydown", "input", "touchstart", "scroll"] as const;

export function useWorkspaceAutoLock(options: {
  minutes: number | undefined;
  userId: string;
  endpointId: string;
  onLock: () => void;
}) {
  const lockFunction = useRef(options.onLock);
  lockFunction.current = options.onLock;

  useEffect(() => {
    if (!options.minutes) return;
    const timeoutMs = options.minutes * 60 * 1000;
    let timer = 0;
    let lastArm = 0;
    const arm = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => lockFunction.current(), timeoutMs);
    };
    const activity = () => {
      const now = Date.now();
      if (now - lastArm < 1000) return;
      lastArm = now;
      touchPinRefreshGrant(options.userId, options.endpointId);
      arm();
    };
    for (const eventName of ACTIVITY_EVENTS) window.addEventListener(eventName, activity, { passive: true });
    arm();
    return () => {
      window.clearTimeout(timer);
      for (const eventName of ACTIVITY_EVENTS) window.removeEventListener(eventName, activity);
    };
  }, [options.endpointId, options.minutes, options.userId]);
}

export function useMobileDrawerGestures(options: {
  treeOpen: boolean;
  outlineOpen: boolean;
  settingsOpen: boolean;
  setTreeOpen: (open: boolean) => void;
  setOutlineOpen: (open: boolean) => void;
}) {
  useEffect(() => {
    let gesture: (MobileDrawerGesture & { touchId: number }) | null = null;
    const reset = () => {
      gesture = null;
      window.removeEventListener("touchmove", move);
    };
    const start = (event: TouchEvent) => {
      if (
        event.touches.length !== 1
        || options.treeOpen
        || options.outlineOpen
        || options.settingsOpen
        || !window.matchMedia("(max-width: 720px)").matches
      ) {
        reset();
        return;
      }
      const touch = event.touches[0];
      const viewportWidth = window.visualViewport?.width ?? window.innerWidth;
      const beginning = beginMobileDrawerGesture(touch.clientX, touch.clientY, viewportWidth);
      gesture = beginning ? { ...beginning, touchId: touch.identifier } : null;
      if (gesture) window.addEventListener("touchmove", move, { passive: false });
    };
    const move = (event: TouchEvent) => {
      if (!gesture) return;
      const touch = [...event.touches].find((candidate) => candidate.identifier === gesture?.touchId);
      if (!touch) {
        reset();
        return;
      }
      if (gestureHasInwardHorizontalIntent(gesture, touch.clientX, touch.clientY)) event.preventDefault();
      const drawer = openedDrawerFromGesture(gesture, touch.clientX, touch.clientY);
      if (drawer) {
        options.setTreeOpen(drawer === "left");
        options.setOutlineOpen(drawer === "right");
        reset();
        return;
      }
      if (gestureBecameVertical(gesture, touch.clientX, touch.clientY)) reset();
    };
    window.addEventListener("touchstart", start, { passive: true });
    window.addEventListener("touchend", reset, { passive: true });
    window.addEventListener("touchcancel", reset, { passive: true });
    return () => {
      window.removeEventListener("touchstart", start);
      window.removeEventListener("touchmove", move);
      window.removeEventListener("touchend", reset);
      window.removeEventListener("touchcancel", reset);
    };
  }, [options.outlineOpen, options.settingsOpen, options.treeOpen]);
}
