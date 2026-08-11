import type { EditorExtension, InlineSourcePresentation } from "../core/lib";

export interface WikiLinkExtensionOptions {
  onNavigate?: (target: string) => void;
}

interface WikiLinkData {
  target: string;
  label: string;
}

function preventDefault(event: Event): void {
  event.preventDefault();
}

function wikiLinkPresentation(
  onNavigate?: WikiLinkExtensionOptions["onNavigate"],
): InlineSourcePresentation<WikiLinkData> {
  return {
    id: "mint-wikilink-inline",
    sourceClassName: "live-wikilink-source",
    widgetClassName: "live-wikilink-widget",
    find(source) {
      const matches = [];
      const pattern = /\[\[([^\]\n]+)\]\]/g;
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(source))) {
        if (match.index > 0 && source[match.index - 1] === "!") continue;
        const parts = match[1]!.split("|");
        const target = (parts.shift() ?? "").trim();
        const label = parts.join("|").trim() || target;
        if (!target) continue;
        matches.push({
          from: match.index,
          to: match.index + match[0].length,
          source: match[0],
          renderSource: label,
          key: `${target}:${label}`,
          data: { target, label },
        });
      }
      return matches;
    },
    render(container, match) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "live-wikilink";
      button.textContent = match.data.label;
      button.setAttribute("aria-label", match.data.target);
      button.addEventListener("mousedown", preventDefault);
      const navigate = () => onNavigate?.(match.data.target);
      button.addEventListener("click", navigate);
      container.appendChild(button);
      return () => {
        button.removeEventListener("mousedown", preventDefault);
        button.removeEventListener("click", navigate);
        button.remove();
      };
    },
  };
}

function wikiEmbedPresentation(
  onNavigate?: WikiLinkExtensionOptions["onNavigate"],
): InlineSourcePresentation<WikiLinkData> {
  return {
    id: "mint-wiki-embed-inline",
    priority: 1,
    sourceClassName: "live-wikilink-source",
    widgetClassName: "live-wikilink-widget live-wiki-embed-widget",
    find(source) {
      const matches = [];
      const pattern = /!\[\[([^\]\n]+)\]\]/g;
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(source))) {
        const parts = match[1]!.split("|");
        const target = (parts.shift() ?? "").trim();
        const label = parts.join("|").trim() || target;
        if (!target) continue;
        matches.push({
          from: match.index,
          to: match.index + match[0].length,
          source: match[0],
          renderSource: label,
          key: `${target}:${label}`,
          data: { target, label },
        });
      }
      return matches;
    },
    render(container, match) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "live-wikilink live-wiki-embed";
      button.textContent = match.data.label;
      button.setAttribute("aria-label", match.data.target);
      button.addEventListener("mousedown", preventDefault);
      const navigate = () => onNavigate?.(match.data.target);
      button.addEventListener("click", navigate);
      container.appendChild(button);
      return () => {
        button.removeEventListener("mousedown", preventDefault);
        button.removeEventListener("click", navigate);
        button.remove();
      };
    },
  };
}

export function createWikiLinkExtension(
  options: WikiLinkExtensionOptions = {},
): EditorExtension {
  return {
    id: "mint-wikilink",
    presentations: {
      inline: [
        wikiEmbedPresentation(options.onNavigate),
        wikiLinkPresentation(options.onNavigate),
      ],
    },
  };
}
