declare module "typora-web" {
  export interface EditorOptions {
    initialContent?: string;
    onChange?: (markdown: string) => void;
    onFocus?: () => void;
    onBlur?: () => void;
    liveSyntax?: {
      renderMath?: (container: HTMLElement, source: string) => void | (() => void);
      renderMathBlock?: (container: HTMLElement, source: string) => void | (() => void);
      renderMermaid?: (container: HTMLElement, source: string) => void | (() => void);
      onWikiLink?: (target: string) => void;
    };
  }

  export interface TyporaWebEditor {
    getMarkdown(): string;
    setMarkdown(markdown: string): void;
    getMarkdownOffsetAtPoint(clientX: number, clientY: number): number;
    insertMarkdown(markdown: string, offset?: number): void;
    replaceMarkdown(markdown: string, offset?: number): void;
    toggleSource(): void;
    isSourceMode(): boolean;
    focus(): void;
    destroy(): void;
  }

  export function createEditor(host: HTMLElement, options?: EditorOptions): TyporaWebEditor;
}
