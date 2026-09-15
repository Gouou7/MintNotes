import { type ReactNode, type RefObject, useLayoutEffect, useRef } from "react";

interface NotePaneLayoutProps {
  toolbar: ReactNode;
  historyBanner?: ReactNode;
  status: ReactNode;
  children: ReactNode;
  editorArea: RefObject<HTMLDivElement | null>;
}

/** Measures chrome only on resize; scrolling never schedules React updates. */
export function NotePaneLayout({ toolbar, historyBanner, status, children, editorArea }: NotePaneLayoutProps) {
  const pane = useRef<HTMLElement>(null);
  const top = useRef<HTMLDivElement>(null);
  const bottom = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const root = pane.current!;
    const header = top.current!;
    const footer = bottom.current!;
    const measure = () => {
      for (const [name, element] of [["top", header], ["bottom", footer]] as const) {
        const height = element.getBoundingClientRect().height;
        // Keep CSS first-paint defaults on detached/layout-free surfaces.
        if (height <= 0) continue;
        const value = `${height}px`;
        if (root.style.getPropertyValue(`--editor-inset-${name}`) !== value) {
          root.style.setProperty(`--editor-inset-${name}`, value);
        }
      }
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(header);
    observer.observe(footer);
    return () => observer.disconnect();
  }, []);

  return <main className="note-pane" ref={pane}>
    <div className="note-pane-top" ref={top}>{toolbar}{historyBanner}</div>
    <div className="editor-area" ref={editorArea}>{children}</div>
    <div className="note-pane-bottom" ref={bottom}>{status}</div>
  </main>;
}
