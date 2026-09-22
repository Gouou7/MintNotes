import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { useWorkspaceViewport } from "./useWorkspaceViewport";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.replaceChildren(); document.documentElement.removeAttribute("style"); });

async function setup(withViewport = true) {
  const viewport = Object.assign(new EventTarget(), { height: 800, offsetTop: 0, scale: 1 });
  vi.stubGlobal("visualViewport", withViewport ? viewport : undefined);
  vi.stubGlobal("innerHeight", 800);
  let layoutHeight = 800;
  vi.spyOn(document.documentElement, "clientHeight", "get").mockImplementation(() => layoutHeight);
  let nextId = 0;
  const frames = new Map<number, FrameRequestCallback>();
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
    frames.set(++nextId, callback);
    return nextId;
  });
  vi.spyOn(window, "cancelAnimationFrame").mockImplementation((id) => { frames.delete(id); });
  const render = vi.fn();
  function Workspace() {
    useWorkspaceViewport();
    render();
    return <div className="app-shell"><textarea defaultValue="正文保持原样" /></div>;
  }
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(<Workspace />));
  const flush = () => {
    const callbacks = [...frames.values()];
    frames.clear();
    callbacks.forEach((callback) => callback(0));
  };
  return { viewport, host, render, frames, flush, style: document.documentElement.style,
    setLayoutHeight: (height: number) => { layoutHeight = height; },
    unmount: () => act(async () => root.unmount()) };
}

it("follows the iOS keyboard and viewport pan, then restores height without remounting or editing", async () => {
  const app = await setup();
  const textarea = app.host.querySelector("textarea")!;
  textarea.focus();
  textarea.setSelectionRange(2, 4);
  textarea.scrollTop = 90;
  const write = vi.spyOn(app.style, "setProperty");
  try {
    expect(app.style.getPropertyValue("--workspace-viewport-height")).toBe("800px");
    app.viewport.height = 440;
    app.viewport.dispatchEvent(new Event("resize"));
    app.viewport.offsetTop = 70;
    app.viewport.dispatchEvent(new Event("scroll"));
    expect(app.frames.size).toBe(1);
    app.flush();
    expect(app.style.getPropertyValue("--workspace-viewport-top")).toBe("70px");
    expect(app.style.getPropertyValue("--workspace-viewport-height")).toBe("440px");
    expect(app.style.getPropertyValue("--workspace-safe-area-bottom")).toBe("0px");
    write.mockClear();
    app.viewport.dispatchEvent(new Event("scroll"));
    app.flush();
    expect(write).not.toHaveBeenCalled();
    app.viewport.height = 800;
    app.viewport.offsetTop = 0;
    app.viewport.dispatchEvent(new Event("resize"));
    app.flush();
    expect(app.style.getPropertyValue("--workspace-viewport-height")).toBe("800px");
    expect(app.style.getPropertyValue("--workspace-viewport-top")).toBe("0px");
    expect(app.style.getPropertyValue("--workspace-safe-area-bottom")).toBe("env(safe-area-inset-bottom, 0px)");
    expect(app.render).toHaveBeenCalledOnce();
    expect(app.host.querySelector("textarea")).toBe(textarea);
    expect(textarea.value).toBe("正文保持原样");
    expect([textarea.selectionStart, textarea.selectionEnd, textarea.scrollTop]).toEqual([2, 4, 90]);
    expect(document.activeElement).toBe(textarea);
  } finally { await app.unmount(); }
});

it("does not subtract the keyboard twice when Android resizes both viewports, including rotation", async () => {
  const app = await setup();
  try {
    app.setLayoutHeight(450);
    app.viewport.height = 450;
    window.dispatchEvent(new Event("resize"));
    app.viewport.dispatchEvent(new Event("resize"));
    app.flush();
    expect(app.style.getPropertyValue("--workspace-viewport-height")).toBe("450px");
    expect(app.style.getPropertyValue("--workspace-viewport-top")).toBe("0px");
    app.setLayoutHeight(320);
    app.viewport.height = 320;
    window.dispatchEvent(new Event("resize"));
    app.flush();
    expect(app.style.getPropertyValue("--workspace-viewport-height")).toBe("320px");
  } finally { await app.unmount(); }
});

it("ignores pinch zoom and transient zero viewport sizes", async () => {
  const app = await setup();
  try {
    app.viewport.height = 400;
    app.viewport.offsetTop = 100;
    app.viewport.scale = 2;
    app.viewport.dispatchEvent(new Event("resize"));
    app.flush();
    expect(app.style.getPropertyValue("--workspace-viewport-height")).toBe("800px");
    expect(app.style.getPropertyValue("--workspace-viewport-top")).toBe("0px");
    expect(app.style.getPropertyValue("--workspace-safe-area-bottom")).not.toBe("0px");
    app.viewport.scale = 1;
    app.viewport.height = 0;
    window.dispatchEvent(new Event("pageshow"));
    app.flush();
    expect(app.style.getPropertyValue("--workspace-viewport-height")).toBe("800px");
  } finally { await app.unmount(); }
});

it("falls back to the layout viewport when VisualViewport is unavailable", async () => {
  const app = await setup(false);
  try {
    app.setLayoutHeight(500);
    window.dispatchEvent(new Event("resize"));
    app.flush();
    expect(app.style.getPropertyValue("--workspace-viewport-height")).toBe("500px");
  } finally { await app.unmount(); }
});

it("cancels queued work and removes listeners and styles on lock or logout", async () => {
  document.documentElement.style.setProperty("--workspace-viewport-top", "5px");
  const app = await setup();
  app.viewport.dispatchEvent(new Event("resize"));
  expect(app.frames.size).toBe(1);
  await app.unmount();
  expect(app.frames.size).toBe(0);
  expect(app.style.getPropertyValue("--workspace-viewport-top")).toBe("5px");
  expect(app.style.getPropertyValue("--workspace-viewport-height")).toBe("");
  expect(app.style.getPropertyValue("--workspace-safe-area-bottom")).toBe("");
  app.viewport.dispatchEvent(new Event("resize"));
  app.viewport.dispatchEvent(new Event("scroll"));
  window.dispatchEvent(new Event("resize"));
  window.dispatchEvent(new Event("pageshow"));
  expect(app.frames.size).toBe(0);
});
