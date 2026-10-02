import { Plugin } from "prosemirror-state";

/** Keep native selection paint in sync with changes to the editable DOM. */
export function nativeSelectionPresentationPlugin(isDeferred: () => boolean): Plugin {
  return new Plugin({
    view(view) {
      const observer = new MutationObserver(() => {});
      observer.observe(view.dom, {
        subtree: true,
        childList: true,
        characterData: true,
        attributes: true,
      });
      return {
        update(current) {
          const changed = observer.takeRecords().length > 0;
          if (!changed || isDeferred() || current.composing
            || current.state.selection.empty || !current.state.selection.visible
            || !current.hasFocus()) return;

          // Revealing syntax can change text wrappers and block layout without
          // moving either endpoint. WebKit then keeps an obsolete painted range,
          // while ProseMirror skips its equivalent native selection. Clear that
          // range and let the public focus API restore it from the model, including
          // backwards selections and custom NodeView selection handling. focus()
          // also coordinates the DOM observer and does not scroll the editor.
          // Resolve the new layout before establishing the painted range.
          // Otherwise WebKit can invalidate even the replacement selection when
          // it later applies the pending marker/indentation style changes.
          current.dom.getBoundingClientRect();
          current.dom.ownerDocument.getSelection()?.removeAllRanges();
          current.focus();
          observer.takeRecords();
        },
        destroy() {
          observer.disconnect();
        },
      };
    },
  });
}
