import katex from "katex";
import { useEffect, useRef, useState } from "react";
import "katex/dist/katex.min.css";

const MAX_MERMAID_SOURCE_LENGTH = 100_000;
let mermaidSequence = 0;
let mermaidModule: Promise<typeof import("mermaid")["default"]> | null = null;

function loadMermaid() {
  mermaidModule ??= import("mermaid").then(({ default: mermaid }) => {
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: "strict",
      flowchart: { htmlLabels: false },
      suppressErrorRendering: true
    });
    return mermaid;
  });
  return mermaidModule;
}

function sanitizeMermaidSvg(svg: string): string {
  const document = new DOMParser().parseFromString(svg, "image/svg+xml");
  const externalReference = /(?:@import|url\(\s*['"]?(?:https?:|\/\/))/i;
  for (const element of document.querySelectorAll("script, iframe, object, embed, image, foreignObject")) element.remove();
  for (const style of document.querySelectorAll("style")) {
    if (externalReference.test(style.textContent ?? "")) style.remove();
  }
  for (const element of document.querySelectorAll("*")) {
    for (const attribute of [...element.attributes]) {
      const name = attribute.name.toLowerCase();
      const value = attribute.value.trim();
      if (name.startsWith("on")) element.removeAttribute(attribute.name);
      if ((name === "href" || name === "xlink:href") && !value.startsWith("#")) {
        element.removeAttribute(attribute.name);
      }
      if (externalReference.test(value)) {
        element.removeAttribute(attribute.name);
      }
    }
  }
  return new XMLSerializer().serializeToString(document.documentElement);
}

export function renderMathInto(container: HTMLElement, source: string, displayMode = false): () => void {
  katex.render(source, container, {
    displayMode,
    throwOnError: false,
    strict: "warn",
    trust: false,
    output: "htmlAndMathml"
  });
  return () => container.replaceChildren();
}

export function renderMermaidInto(container: HTMLElement, source: string): () => void {
  let cancelled = false;
  let objectUrl: string | null = null;
  container.classList.add("is-rendering");
  container.textContent = "Rendering diagram…";

  void (async () => {
    try {
      if (source.length > MAX_MERMAID_SOURCE_LENGTH) throw new Error("Mermaid source is too large");
      const mermaid = await loadMermaid();
      const { svg } = await mermaid.render(`mint-mermaid-${++mermaidSequence}`, source);
      if (cancelled) return;
      const safeSvg = sanitizeMermaidSvg(svg);
      objectUrl = URL.createObjectURL(new Blob([safeSvg], { type: "image/svg+xml" }));
      const image = document.createElement("img");
      image.src = objectUrl;
      image.alt = "Mermaid diagram";
      image.draggable = false;
      container.replaceChildren(image);
      container.classList.remove("is-rendering", "has-error");
    } catch {
      if (cancelled) return;
      container.textContent = "Unable to render Mermaid diagram";
      container.classList.remove("is-rendering");
      container.classList.add("has-error");
    }
  })();

  return () => {
    cancelled = true;
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    container.replaceChildren();
  };
}

export function MermaidDiagram({ source }: { source: string }) {
  const host = useRef<HTMLDivElement>(null);
  const [sourceAtRender, setSourceAtRender] = useState(source);

  useEffect(() => {
    setSourceAtRender(source);
    if (!host.current) return;
    return renderMermaidInto(host.current, source);
  }, [source]);

  return (
    <figure className="mermaid-diagram">
      <div ref={host} className="mermaid-diagram-canvas" />
      <figcaption className="sr-only">Mermaid diagram generated from: {sourceAtRender}</figcaption>
    </figure>
  );
}
