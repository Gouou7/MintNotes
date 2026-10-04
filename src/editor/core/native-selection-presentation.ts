import { Plugin } from "prosemirror-state";

/** Keep native selection paint in sync with changes to the editable DOM. */
export function nativeSelectionPresentationPlugin(isDeferred: () => boolean): Plugin {
  return new Plugin({
    view(view) {
      const ownerWindow = view.dom.ownerDocument.defaultView;
      if (!ownerWindow) return {};
      let dirty = false;
      let frame: number | null = null;
      let destroyed = false;

      function cancelFrame(): void {
        if (frame === null) return;
        ownerWindow!.cancelAnimationFrame(frame);
        frame = null;
      }

      function canRestore(): boolean {
        return !destroyed && !isDeferred() && !view.composing
          && !view.state.selection.empty && view.state.selection.visible
          && view.dom.isConnected && view.hasFocus();
      }

      function scheduleRestore(): void {
        if (!canRestore()) {
          cancelFrame();
          return;
        }
        if (!dirty || frame !== null) return;
        frame = ownerWindow!.requestAnimationFrame(() => {
          frame = null;
          if (!canRestore()) return;
          dirty = false;
          observer.takeRecords();

          // Safari can invalidate selection paint after the synchronous view
          // update has ended. Restore once before the next paint, using the
          // current model rather than endpoints captured before a newer edit.
          // Resolve layout first, then let ProseMirror's public focus API rebuild
          // the native range, including backwards and custom NodeView selections.
          view.dom.getBoundingClientRect();
          view.dom.ownerDocument.getSelection()?.removeAllRanges();
          view.focus();
          // Ignore the focus/selection classes changed by our own restoration.
          observer.takeRecords();
        });
      }

      const observer = new MutationObserver((records) => {
        if (!records.length) return;
        dirty = true;
        scheduleRestore();
      });
      observer.observe(view.dom, {
        subtree: true,
        childList: true,
        characterData: true,
        attributes: true,
      });
      return {
        update() {
          dirty = observer.takeRecords().length > 0 || dirty;
          // Keep dirty work through pointer/IME deferral. A later commit may
          // leave the DOM unchanged but must still restore the painted range.
          scheduleRestore();
        },
        destroy() {
          destroyed = true;
          cancelFrame();
          observer.disconnect();
        },
      };
    },
  });
}
