import { type KeyboardEvent, type PointerEvent, useRef } from "react";

interface PaneResizerProps {
  label: string;
  side: "left" | "right";
  value: number;
  min: number;
  max: number;
  onResize: (width: number) => void;
}

export function PaneResizer({ label, side, value, min, max, onResize }: PaneResizerProps) {
  const start = useRef({ x: 0, width: value });
  const clamp = (width: number) => Math.min(max, Math.max(min, width));

  const beginResize = (event: PointerEvent<HTMLDivElement>) => {
    start.current = { x: event.clientX, width: value };
    event.currentTarget.setPointerCapture(event.pointerId);
    document.documentElement.classList.add("pane-resizing");
    event.preventDefault();
  };

  const resize = (event: PointerEvent<HTMLDivElement>) => {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
    const delta = event.clientX - start.current.x;
    onResize(clamp(start.current.width + (side === "left" ? delta : -delta)));
  };

  const finishResize = (event: PointerEvent<HTMLDivElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    document.documentElement.classList.remove("pane-resizing");
  };

  const resizeWithKeyboard = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    const direction = event.key === "ArrowRight" ? 1 : -1;
    onResize(clamp(value + (side === "left" ? direction : -direction) * 12));
    event.preventDefault();
  };

  return (
    <div
      className={`pane-resizer pane-resizer-${side}`}
      role="separator"
      aria-label={label}
      aria-orientation="vertical"
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={Math.round(value)}
      tabIndex={0}
      onPointerDown={beginResize}
      onPointerMove={resize}
      onPointerUp={finishResize}
      onPointerCancel={finishResize}
      onLostPointerCapture={() => document.documentElement.classList.remove("pane-resizing")}
      onKeyDown={resizeWithKeyboard}
    />
  );
}
