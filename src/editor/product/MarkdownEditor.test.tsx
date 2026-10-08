import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { I18nProvider } from "../../i18n";
import { MarkdownEditor } from "./MarkdownEditor";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined;
afterEach(async () => { await act(async () => root?.unmount()); root = undefined; document.body.replaceChildren(); });

it("retains source visibility and independent permissions when switching notes and unlocking", async () => {
  const host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  const changed = vi.fn();
  const render = async (documentKey: string, readOnly: boolean) => act(async () => root!.render(<I18nProvider>
    <MarkdownEditor documentKey={documentKey} markdown={`Body ${documentKey}`} mode="source" readOnly={readOnly} onChange={changed} />
  </I18nProvider>));
  await render("a", true); const source = host.querySelector<HTMLTextAreaElement>("textarea")!;
  expect(source.readOnly).toBe(true); expect(source.hidden).toBe(false); expect(source.value).toBe("Body a");
  await render("b", true); expect(source.value).toBe("Body b"); expect(source.readOnly).toBe(true);
  await render("b", false); expect(source.readOnly).toBe(false); expect(changed).not.toHaveBeenCalled();
  await act(async () => { source.value += "!"; source.dispatchEvent(new Event("input", { bubbles: true })); });
  expect(changed).toHaveBeenCalledWith("Body b!", "b");
});

it("keeps a new note's native quote input unescaped through controlled save updates", async () => {
  const changed = vi.fn();
  function Note() {
    const [markdown, setMarkdown] = useState("");
    return <MarkdownEditor documentKey="a" markdown={markdown} mode="live" onChange={(text, key) => {
      changed(text, key); setMarkdown(text);
    }} />;
  }
  const host = document.createElement("div"); document.body.append(host);
  root = createRoot(host);
  await act(async () => root!.render(<I18nProvider><Note /></I18nProvider>));
  const live = host.querySelector<HTMLElement>(".ProseMirror")!;
  live.focus();
  async function nativeInput(text: string) {
    await act(async () => {
      const paragraph = live.querySelector("p")!;
      paragraph.textContent = text;
      const range = document.createRange();
      range.selectNodeContents(paragraph); range.collapse(false);
      const selection = window.getSelection()!;
      selection.removeAllRanges(); selection.addRange(range);
      live.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: text }));
      await new Promise(resolve => setTimeout(resolve, 20));
    });
  }
  await nativeInput(">");
  expect(changed).toHaveBeenLastCalledWith(">", "a");
  expect(live.querySelector("p")?.textContent).toBe(">");
  await nativeInput("> ");
  expect(live.querySelector("blockquote p")).not.toBeNull();
  expect(changed).toHaveBeenLastCalledWith("> ", "a");
  await nativeInput("quoted");
  expect(live.querySelector("blockquote p")?.textContent).toBe("quoted");
  expect(changed).toHaveBeenLastCalledWith("> quoted", "a");
});
