import hljs from "highlight.js/lib/core";
import javascript from "highlight.js/lib/languages/javascript";
import typescript from "highlight.js/lib/languages/typescript";
import json from "highlight.js/lib/languages/json";
import xml from "highlight.js/lib/languages/xml";
import css from "highlight.js/lib/languages/css";
import python from "highlight.js/lib/languages/python";
import bash from "highlight.js/lib/languages/bash";
import yaml from "highlight.js/lib/languages/yaml";
import markdown from "highlight.js/lib/languages/markdown";
import sql from "highlight.js/lib/languages/sql";
import { Plugin } from "prosemirror-state";
import { Decoration, DecorationSet } from "prosemirror-view";
import type { FeatureSpec } from "../features/_types.ts";
import type { MintContext } from "./context.ts";

for (const [name, grammar] of Object.entries({ javascript, typescript, json, xml, css, python, bash, yaml, markdown, sql })) hljs.registerLanguage(name, grammar);
const aliases: Record<string, string> = { js: "javascript", jsx: "javascript", ts: "typescript", tsx: "typescript", html: "xml", sh: "bash", shell: "bash", yml: "yaml", md: "markdown" };
export function highlightRanges(source: string, language: string): { from: number; to: number; className: string }[] {
  const name = aliases[language.toLowerCase()] ?? language.toLowerCase();
  if (source.length > 100_000 || !hljs.getLanguage(name)) return [];
  try {
    const html = hljs.highlight(source, { language: name, ignoreIllegals: true }).value;
    const document = new DOMParser().parseFromString(html, "text/html");
    if (document.body.textContent !== source) return [];
    const result: { from: number; to: number; className: string }[] = [];
    let offset = 0;
    const walk = (node: Node, classes: string[]) => {
      if (node.nodeType === 3) { const text = node.textContent ?? ""; if (classes.length && text.length) result.push({ from: offset, to: offset + text.length, className: classes.join(" ") }); offset += text.length; return; }
      if (node instanceof Element && node.tagName !== "SPAN" && node !== document.body) throw new Error("Unexpected highlight element");
      const next = node instanceof Element ? [...classes, ...Array.from(node.classList).filter(name => /^hljs-[a-z_-]+$/.test(name))] : classes;
      node.childNodes.forEach(child => walk(child, next));
    };
    walk(document.body, []); return result;
  } catch { return []; }
}

function codePresentation(context: MintContext): Plugin {
  const cleanup = new Map<HTMLElement, () => void>();
  let cache = new WeakMap<import("prosemirror-model").Node, ReturnType<typeof highlightRanges>>();
  return new Plugin({ props: {
    decorations(state) {
      const output: Decoration[] = [];
      state.doc.descendants((node, pos) => {
        if (node.type.name !== "code_block") return true;
        if (node.attrs.lang?.toLowerCase().split(/\s/)[0] === "mermaid") return false;
        let ranges = cache.get(node); if (!ranges) { ranges = highlightRanges(node.textContent, String(node.attrs.lang ?? "").split(/\s/)[0]); cache.set(node, ranges); }
        for (const range of ranges) output.push(Decoration.inline(pos + 1 + range.from, pos + 1 + range.to, { class: range.className }));
        output.push(Decoration.widget(pos + 1, () => {
          const actions = document.createElement("div"), copy = document.createElement("button");
          actions.className = "mint-code-actions"; actions.contentEditable = "false"; copy.type = "button";
          copy.setAttribute("aria-label", context.label?.("copyCode") ?? "Copy code");
          let iconName = "copy", icon = context.icon?.(iconName); if (icon) copy.append(icon.element);
          copy.addEventListener("mousedown", event => event.preventDefault());
          let disposed = false, requestId = 0; let timer: ReturnType<typeof setTimeout> | undefined;
          const feedback = (state?: "copied" | "failed") => {
            if (state) copy.dataset.copyState = state; else delete copy.dataset.copyState;
            const label = state === "copied" ? "codeCopied" : state === "failed" ? "codeCopyFailed" : "copyCode";
            copy.setAttribute("aria-label", context.label?.(label) ?? (state === "copied" ? "Copied" : state === "failed" ? "Copy failed" : "Copy code"));
            const nextIcon = state === "copied" ? "copy-success" : "copy";
            if (nextIcon !== iconName) {
              icon?.destroy(); iconName = nextIcon; icon = context.icon?.(iconName); copy.replaceChildren(); if (icon) copy.append(icon.element);
            }
          };
          copy.addEventListener("click", async event => {
            event.preventDefault();
            if (disposed) return;
            const request = ++requestId; let state: "copied" | "failed";
            try { await navigator.clipboard.writeText(node.textContent.endsWith("\n") ? node.textContent : node.textContent + "\n"); state = "copied"; }
            catch { state = "failed"; }
            if (disposed || request !== requestId) return;
            feedback(state);
            if (timer) clearTimeout(timer); timer = setTimeout(() => { timer = undefined; feedback(); }, state === "copied" ? 800 : 1200);
          });
          actions.append(copy); cleanup.set(actions, () => { disposed = true; if (timer) clearTimeout(timer); icon?.destroy(); }); return actions;
        }, { key: `mint-copy-${pos}-${node.attrs.lang ?? ""}-${node.textContent}-${context.revision ?? 0}`, side: -1, stopEvent: () => true, destroy: node => { cleanup.get(node as HTMLElement)?.(); cleanup.delete(node as HTMLElement); } }));
        return false;
      }); return DecorationSet.create(state.doc, output);
    }
  }, view: () => ({ destroy() { cleanup.forEach(dispose => dispose()); cleanup.clear(); cache = new WeakMap(); } }) });
}
export const codePresentationFeature: FeatureSpec = { name: "mint-code-presentation", plugins: (_schema, context = {}) => [codePresentation(context)] };
