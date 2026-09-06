import { act, createRef } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../i18n";
import { MarkdownEditor, type MarkdownEditorHandle } from "./MarkdownEditor";
import type { WorkspaceEditorMode } from "../types";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("shared product editor session", () => {
  it("retains live/source/reading undo and directional source selection in one controller", async () => {
    const initial = "---\ntags: x\n---\n\n# title\n\nbody";
    let markdown = initial;
    const onChange = vi.fn((source: string) => { markdown = source; });
    const host = document.createElement("div"); document.body.append(host);
    const root = createRoot(host);
    const ref = createRef<MarkdownEditorHandle>();
    const render = async (mode: WorkspaceEditorMode) => act(async () => root.render(
      <I18nProvider><MarkdownEditor ref={ref} markdown={markdown} mode={mode} onChange={onChange} /></I18nProvider>
    ));
    await render("live");
    const originalLive = host.querySelector(".ProseMirror")!;
    await act(async () => {
      ref.current!.setSelectionOffset(initial.indexOf("title") + 2);
      originalLive.dispatchEvent(new InputEvent("beforeinput", { data: "X", inputType: "insertText", bubbles: true, cancelable: true }));
    });
    expect(markdown).toBe(initial.replace("title", "tiXtle"));
    await render("source");
    const textarea = host.querySelector("textarea")!;
    textarea.setSelectionRange(initial.indexOf("title"), initial.indexOf("title") + 4, "backward");
    await render("reading");
    expect(host.querySelector(".ProseMirror")).toBe(originalLive);
    expect(host.querySelector(".reading-editor")?.textContent).toContain("tiXtle");
    await render("source");
    expect(textarea.selectionStart).toBe(initial.indexOf("title"));
    expect(textarea.selectionEnd).toBe(initial.indexOf("title") + 4);
    expect(textarea.selectionDirection).toBe("backward");
    expect(onChange).toHaveBeenCalledTimes(1);
    await act(async () => {
      textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "z", metaKey: true, ctrlKey: true, bubbles: true, cancelable: true }));
    });
    expect(markdown).toBe(initial);
    await render("live");
    await act(async () => originalLive.dispatchEvent(new KeyboardEvent("keydown", { key: "z", metaKey: true, ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true })));
    expect(markdown).toBe(initial.replace("title", "tiXtle"));
    await act(async () => root.unmount()); host.remove();
  });
});
