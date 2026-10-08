import { useCallback, useRef } from "react";
import type { OpenDocument } from "../../types";
import { attachmentIdsIn } from "../attachments";

interface Options {
  document: OpenDocument | null;
  previewing: boolean;
  readOnly?: boolean;
  findDocument(id: string): OpenDocument | undefined;
  patchDocument(id: string, patch: { markdown: string; attachmentIds: string[] }): void;
  saveImage(id: string, file: File): Promise<string | null>;
}
/** Own the document identity at the workspace boundary, including async work. */
export function useNoteEditorIntegration(options: Options) {
  const current = useRef(options); current.current = options;
  const onChange = useCallback((markdown: string, documentKey?: string) => {
    const { document, previewing, readOnly, findDocument, patchDocument } = current.current;
    // The engine may finish an identified IME commit after a read-only request.
    if (!documentKey && (!document || previewing || readOnly || document.locked)) return;
    const latest = findDocument(documentKey ?? document!.objectId);
    if (!latest || latest.deleted || latest.locked || latest.markdown === markdown) return;
    patchDocument(latest.objectId, { markdown, attachmentIds: [...new Set([...latest.attachmentIds, ...attachmentIdsIn(markdown)])] });
  }, []);
  const onImageInsert = useCallback(async (file: File) => {
    const { document, previewing, readOnly, saveImage } = current.current;
    if (!document || previewing || readOnly || document.locked) return null;
    const id = document.objectId;
    return saveImage(id, file);
  }, []);
  return { onChange, onImageInsert };
}
