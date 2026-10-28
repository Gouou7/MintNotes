import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { createMintEditor } from "../engine";
import { renderMermaidInto } from "./richRenderers";

const mermaid = vi.hoisted(() => ({ initialize: vi.fn(), render: vi.fn() }));
vi.mock("mermaid", () => ({ default: mermaid }));

const svg = '<svg xmlns="http://www.w3.org/2000/svg"><text>Diagram</text></svg>';
const labels = { rendering: "Rendering", failed: "Failed", alt: "Diagram" };
const cleanups: (() => void)[] = [];
let createUrl: MockInstance<typeof URL.createObjectURL>, revokeUrl: MockInstance<typeof URL.revokeObjectURL>;

function preview(source = "sequenceDiagram\nA->>B: Message") {
  const host = document.createElement("div");
  document.body.append(host);
  const dispose = renderMermaidInto(host, source, labels);
  cleanups.push(dispose);
  return { host, dispose };
}

beforeEach(() => {
  document.documentElement.dataset.theme = "light";
  mermaid.initialize.mockReset();
  mermaid.render.mockReset().mockResolvedValue({ svg });
  let sequence = 0;
  createUrl = vi.spyOn(URL, "createObjectURL").mockImplementation(() => `blob:diagram-${++sequence}`);
  revokeUrl = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
});

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
  document.body.replaceChildren();
  delete document.documentElement.dataset.theme;
  vi.restoreAllMocks();
});

describe("Mermaid theme and preview lifecycle", () => {
  it.each(["light", "dark"])("renders the initial %s app theme with strict SVG settings", async theme => {
    document.documentElement.dataset.theme = theme;
    const { host } = preview();
    await vi.waitFor(() => expect(host.querySelector("img")).not.toBeNull());
    expect(mermaid.initialize).toHaveBeenCalledWith({
      startOnLoad: false, securityLevel: "strict", theme: theme === "dark" ? "dark" : "default",
      darkMode: theme === "dark", htmlLabels: false, suppressErrorRendering: true
    });
    expect(host.querySelector("img")?.alt).toBe(labels.alt);
    expect(host.classList.contains("is-rendering")).toBe(false);
  });

  it("replaces the preview on theme changes, keeps it while rendering and releases its URLs", async () => {
    const { host, dispose } = preview();
    await vi.waitFor(() => expect(createUrl).toHaveBeenCalledTimes(1));
    let finish!: (result: { svg: string }) => void;
    mermaid.render.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
    document.documentElement.dataset.theme = "dark";
    await vi.waitFor(() => expect(mermaid.render).toHaveBeenCalledTimes(2));
    expect(host.querySelector("img")?.getAttribute("src")).toBe("blob:diagram-1");
    expect(revokeUrl).not.toHaveBeenCalled();
    finish({ svg });
    await vi.waitFor(() => expect(host.querySelector("img")?.getAttribute("src")).toBe("blob:diagram-2"));
    expect(revokeUrl).toHaveBeenCalledExactlyOnceWith("blob:diagram-1");
    document.documentElement.dataset.theme = "dark";
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(mermaid.render).toHaveBeenCalledTimes(2);
    dispose();
    expect(revokeUrl).toHaveBeenLastCalledWith("blob:diagram-2");
    document.documentElement.dataset.theme = "light";
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(mermaid.render).toHaveBeenCalledTimes(2);
    expect(host.childElementCount).toBe(0);
  });

  it("serializes shared theme configuration and discards stale renders and queued requests", async () => {
    document.documentElement.dataset.theme = "dark";
    let finish!: (result: { svg: string }) => void;
    mermaid.render.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
    const first = preview("flowchart LR\nA-->B");
    await vi.waitFor(() => expect(mermaid.render).toHaveBeenCalledTimes(1));
    const second = preview();
    document.documentElement.dataset.theme = "light";
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(mermaid.initialize).toHaveBeenCalledTimes(1);
    finish({ svg });
    await vi.waitFor(() => {
      expect(second.host.querySelector("img")).not.toBeNull();
      expect(first.host.querySelector("img")).not.toBeNull();
    });
    expect(mermaid.initialize.mock.calls.map(([config]) => config.theme)).toEqual(["dark", "default", "default"]);
    expect(createUrl).toHaveBeenCalledTimes(2);
  });

  it("ignores in-flight results and skips queued previews after disposal", async () => {
    let finish!: (result: { svg: string }) => void;
    mermaid.render.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
    const first = preview();
    await vi.waitFor(() => expect(mermaid.render).toHaveBeenCalledTimes(1));
    const second = preview();
    first.dispose(); second.dispose();
    finish({ svg });
    const active = preview();
    await vi.waitFor(() => expect(active.host.querySelector("img")).not.toBeNull());
    expect(mermaid.render).toHaveBeenCalledTimes(2);
    expect(createUrl).toHaveBeenCalledTimes(1);
    expect(first.host.childElementCount).toBe(0);
    expect(second.host.childElementCount).toBe(0);
  });

  it("releases a failed replacement and can render again after another theme change", async () => {
    const { host } = preview();
    await vi.waitFor(() => expect(createUrl).toHaveBeenCalledTimes(1));
    mermaid.render.mockRejectedValueOnce(new Error("Render failed"));
    document.documentElement.dataset.theme = "dark";
    await vi.waitFor(() => expect(host.textContent).toBe(labels.failed));
    expect(revokeUrl).toHaveBeenCalledExactlyOnceWith("blob:diagram-1");
    expect(host.classList.contains("has-error")).toBe(true);
    document.documentElement.dataset.theme = "light";
    await vi.waitFor(() => expect(host.querySelector("img")).not.toBeNull());
    expect(host.classList.contains("has-error")).toBe(false);
  });

  it.each([false, true])("updates the editor preview without saving (readOnly=%s)", async readOnly => {
    const source = "```mermaid\nsequenceDiagram\nA->>B: Message\n```";
    const host = document.createElement("div"), changed = vi.fn();
    document.body.append(host);
    const editor = createMintEditor(host, { initialContent: source, readOnly, onChange: changed,
      renderMermaid: (container, source) => renderMermaidInto(container, source, labels) });
    cleanups.push(() => editor.destroy());
    await vi.waitFor(() => expect(host.querySelector(".mint-block-preview img")).not.toBeNull());
    document.documentElement.dataset.theme = "dark";
    await vi.waitFor(() => expect(createUrl).toHaveBeenCalledTimes(2));
    editor.flush();
    expect(editor.getMarkdown()).toBe(source);
    expect(changed).not.toHaveBeenCalled();
  });
});
