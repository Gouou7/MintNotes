import { useLayoutEffect } from "react";

const VIEWPORT_PROPERTIES = ["--workspace-viewport-top", "--workspace-viewport-height", "--workspace-safe-area-bottom"] as const;

/** Keep the workspace inside the keyboard-adjusted viewport without rebuilding the editor. */
export function useWorkspaceViewport(): void {
  useLayoutEffect(() => {
    const style = document.documentElement.style;
    const previous = VIEWPORT_PROPERTIES.map((name) => [name, style.getPropertyValue(name)] as const);
    const viewport = window.visualViewport;
    let frame: number | null = null;
    const measure = () => {
      frame = null;
      const layoutHeight = document.documentElement.clientHeight || window.innerHeight;
      // Pinch zoom must keep its native panning behavior, not resize the workspace.
      const visible = viewport && Math.abs(viewport.scale - 1) < 0.01
        && Number.isFinite(viewport.height) && viewport.height > 0 ? viewport : null;
      const height = visible ? Math.min(layoutHeight, visible.height) : layoutHeight;
      const top = visible ? Math.max(0, visible.offsetTop) : 0;
      const values = [`${top}px`, `${height}px`, visible && height < layoutHeight - 1 ? "0px" : "env(safe-area-inset-bottom, 0px)"];
      VIEWPORT_PROPERTIES.forEach((name, index) => {
        if (style.getPropertyValue(name) !== values[index]) style.setProperty(name, values[index]!);
      });
    };
    const schedule = () => {
      if (frame === null) frame = window.requestAnimationFrame(measure);
    };
    measure();
    // Only viewport geometry is observed; document scrolling never updates React.
    viewport?.addEventListener("resize", schedule);
    viewport?.addEventListener("scroll", schedule);
    window.addEventListener("resize", schedule);
    window.addEventListener("pageshow", schedule);
    return () => {
      viewport?.removeEventListener("resize", schedule);
      viewport?.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      window.removeEventListener("pageshow", schedule);
      if (frame !== null) window.cancelAnimationFrame(frame);
      for (const [name, value] of previous) {
        if (value) style.setProperty(name, value);
        else style.removeProperty(name);
      }
    };
  }, []);
}
