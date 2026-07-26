import { describe, expect, it } from "vitest";
import {
  beginMobileDrawerGesture,
  gestureBecameVertical,
  gestureHasInwardHorizontalIntent,
  openedDrawerFromGesture
} from "./mobileDrawerGesture";

describe("mobile drawer edge gestures", () => {
  it("only starts inside the left or right screen edge", () => {
    expect(beginMobileDrawerGesture(12, 200, 390)?.edge).toBe("left");
    expect(beginMobileDrawerGesture(378, 200, 390)?.edge).toBe("right");
    expect(beginMobileDrawerGesture(100, 200, 390)).toBeNull();
  });

  it("opens the drawer only after an inward horizontal swipe", () => {
    const left = beginMobileDrawerGesture(10, 200, 390)!;
    const right = beginMobileDrawerGesture(380, 200, 390)!;

    expect(openedDrawerFromGesture(left, 76, 210)).toBe("left");
    expect(openedDrawerFromGesture(right, 314, 190)).toBe("right");
    expect(openedDrawerFromGesture(left, 70, 285)).toBeNull();
    expect(openedDrawerFromGesture(left, -60, 200)).toBeNull();
    expect(openedDrawerFromGesture(right, 450, 200)).toBeNull();
  });

  it("detects horizontal intent before the drawer-opening distance", () => {
    const left = beginMobileDrawerGesture(10, 200, 390)!;
    const right = beginMobileDrawerGesture(380, 200, 390)!;

    expect(gestureHasInwardHorizontalIntent(left, 24, 202)).toBe(true);
    expect(gestureHasInwardHorizontalIntent(right, 366, 198)).toBe(true);
    expect(gestureHasInwardHorizontalIntent(left, 18, 200)).toBe(false);
    expect(gestureHasInwardHorizontalIntent(left, 24, 220)).toBe(false);
  });

  it("abandons a gesture once it clearly becomes vertical", () => {
    const gesture = beginMobileDrawerGesture(10, 200, 390)!;

    expect(gestureBecameVertical(gesture, 16, 220)).toBe(true);
    expect(gestureBecameVertical(gesture, 30, 210)).toBe(false);
  });
});
