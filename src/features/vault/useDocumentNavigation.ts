import { useCallback, useEffect, useRef, type RefObject } from "react";
import type { MarkdownEditorHandle } from "../../editor/MarkdownEditor";
import type { OutlineItem, WorkspaceEditorMode } from "../../types";

export const HEADING_VIEWPORT_POSITION = 0.4;

const RENDERED_HEADING_SELECTOR = "h1,h2,h3,h4,h5,h6,pre[data-source-block][data-source-kind^='heading-'],.heading-draft-1,.heading-draft-2,.heading-draft-3,.heading-draft-4,.heading-draft-5,.heading-draft-6";

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

export function documentScrollElement(editorArea: HTMLElement): HTMLElement {
  return editorArea.querySelector<HTMLElement>(".source-editor") ?? editorArea;
}

export function readScrollProgress(element: HTMLElement): number {
  const maximum = Math.max(0, element.scrollHeight - element.clientHeight);
  return maximum > 0 ? clamp(element.scrollTop / maximum, 0, 1) : 0;
}

export function restoreScrollProgress(element: HTMLElement, progress: number): void {
  const maximum = Math.max(0, element.scrollHeight - element.clientHeight);
  element.scrollTop = maximum * clamp(progress, 0, 1);
}

export function scrollElementToViewportPosition(
  scroller: HTMLElement,
  target: HTMLElement,
  behavior: ScrollBehavior = "smooth"
): void {
  const scrollerRect = scroller.getBoundingClientRect();
  const targetRect = target.getBoundingClientRect();
  const targetTop = scroller.scrollTop + targetRect.top - scrollerRect.top;
  const maximum = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
  scroller.scrollTo({
    top: clamp(targetTop - scroller.clientHeight * HEADING_VIEWPORT_POSITION, 0, maximum),
    behavior
  });
}

export function renderedHeadingElements(editorArea: HTMLElement): HTMLElement[] {
  const documentRoot = editorArea.querySelector<HTMLElement>(".markdown-editor-host .ProseMirror")
    ?? editorArea.querySelector<HTMLElement>(".readonly-markdown");
  if (!documentRoot) return [];
  return [...documentRoot.children]
    .filter((element): element is HTMLElement => element instanceof HTMLElement && element.matches(RENDERED_HEADING_SELECTOR));
}

export function sourceHeadingScrollTop(textarea: HTMLTextAreaElement, sourceLine: number): number {
  const lineCount = Math.max(1, textarea.value.split(/\r\n|\r|\n/).length);
  const lineProgress = lineCount > 1 ? clamp(sourceLine / (lineCount - 1), 0, 1) : 0;
  const estimatedHeadingTop = textarea.scrollHeight * lineProgress;
  const maximum = Math.max(0, textarea.scrollHeight - textarea.clientHeight);
  return clamp(estimatedHeadingTop - textarea.clientHeight * HEADING_VIEWPORT_POSITION, 0, maximum);
}

interface DocumentNavigation {
  editorArea: RefObject<HTMLDivElement | null>;
  editorSurface: RefObject<MarkdownEditorHandle | null>;
  prepareModeChange: (nextMode: WorkspaceEditorMode) => boolean;
  jumpToHeading: (item: OutlineItem, behavior?: ScrollBehavior) => boolean;
}

export function useDocumentNavigation(mode: WorkspaceEditorMode): DocumentNavigation {
  const editorArea = useRef<HTMLDivElement>(null);
  const editorSurface = useRef<MarkdownEditorHandle>(null);
  const modeRef = useRef(mode);
  const pendingSelection = useRef<number | null>(null);
  const pendingScrollProgress = useRef<number | null>(null);
  modeRef.current = mode;

  useEffect(() => {
    const selection = pendingSelection.current;
    const progress = pendingScrollProgress.current;
    if (selection === null && progress === null) return;

    let layoutFrame = 0;
    const mountFrame = window.requestAnimationFrame(() => {
      if (selection !== null && mode !== "readonly") {
        pendingSelection.current = null;
        editorSurface.current?.setSelectionOffset(selection);
      }
      layoutFrame = window.requestAnimationFrame(() => {
        const area = editorArea.current;
        if (area && progress !== null) restoreScrollProgress(documentScrollElement(area), progress);
        pendingScrollProgress.current = null;
      });
    });
    return () => {
      window.cancelAnimationFrame(mountFrame);
      window.cancelAnimationFrame(layoutFrame);
    };
  }, [mode]);

  const prepareModeChange = useCallback((nextMode: WorkspaceEditorMode): boolean => {
    if (nextMode === modeRef.current) return false;
    const area = editorArea.current;
    if (area) pendingScrollProgress.current = readScrollProgress(documentScrollElement(area));
    if (modeRef.current !== "readonly") {
      pendingSelection.current = editorSurface.current?.getSelectionOffset() ?? null;
    }
    return true;
  }, []);

  const jumpToHeading = useCallback((item: OutlineItem, behavior: ScrollBehavior = "smooth"): boolean => {
    const area = editorArea.current;
    if (!area) return false;
    const sourceEditor = area.querySelector<HTMLTextAreaElement>(".source-editor");
    if (sourceEditor) {
      editorSurface.current?.setSelectionOffset(item.sourceOffset);
      sourceEditor.scrollTo({ top: sourceHeadingScrollTop(sourceEditor, item.sourceLine), behavior });
      return true;
    }

    const target = renderedHeadingElements(area)[item.index];
    if (!target) return false;
    scrollElementToViewportPosition(area, target, behavior);
    return true;
  }, []);

  return { editorArea, editorSurface, prepareModeChange, jumpToHeading };
}
