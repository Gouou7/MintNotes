export interface CalloutAppearance {
  kind: string; title: string; fold: string; color?: string; icon?: string;
}
export interface MintContext {
  readOnly?: boolean;
  revision?: number;
  footnotes?: Map<string, { number: number; positions: number[]; body?: string }>;
  resolveImageSource?: (source: string) => string | null | undefined;
  renderMath?: (host: HTMLElement, source: string, display: boolean) => void | (() => void);
  renderMermaid?: (host: HTMLElement, source: string) => void | (() => void);
  renderMarkdown?: (host: HTMLElement, source: string) => void | (() => void);
  parseCallout?: (source: string) => CalloutAppearance | null;
  onNavigate?: (target: string) => void;
  icon?: (name: string) => { element: HTMLElement; destroy(): void };
  label?: (name: string) => string;
}
export function safeImage(source: string, context: MintContext): string | null {
  const resolved = context.resolveImageSource?.(source);
  if (/^webmd-attachment:/i.test(source)) return typeof resolved === "string" && resolved.startsWith("blob:") ? resolved : null;
  try { const url = new URL(source); return url.protocol === "https:" ? url.href : null; } catch { return null; }
}
export function safeLink(href: string): boolean {
  const candidate = href.trim().replace(/[\t\r\n]/g, "");
  if (!candidate || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(candidate)) return false;
  return /^(?:https?:|mailto:|#)/i.test(candidate) || !/^[a-z][a-z0-9+.-]*:/i.test(candidate) && !/^[\/\\]{2}/.test(candidate);
}
