import { useEffect, useRef } from "react";
import type { OpenDocument } from "../../types";
import { siblingNameRepairs } from "../siblingNames";

interface Options {
  documents: OpenDocument[];
  enabled: boolean;
  getDocuments: () => OpenDocument[];
  queueDocument: (document: OpenDocument, delay: number) => void;
  onRepair: (count: number) => void;
}
export function useSiblingNameRepair(options: Options) {
  const previous = useRef<OpenDocument[] | null>(null);
  const current = useRef(options);
  current.current = options;
  useEffect(() => {
    if (!options.enabled) return;
    const dependencies = current.current;
    const documents = dependencies.getDocuments();
    const before = previous.current;
    previous.current = documents;
    const namesChanged = !before || before.length !== documents.length || documents.some((document, index) => {
      const old = before[index];
      return old.objectId !== document.objectId || old.title !== document.title || old.parentId !== document.parentId || old.deleted !== document.deleted;
    });
    // Body edits and save acknowledgements must not sort/check every namespace again.
    if (!namesChanged) return;
    const repairs = siblingNameRepairs(documents);
    for (const repair of repairs) {
      const document = documents.find((entry) => entry.objectId === repair.objectId)!;
      // The save queue publishes synchronously and retries failures without replacing newer body edits.
      dependencies.queueDocument({ ...document, title: repair.title, dirty: true }, 0);
    }
    if (repairs.length) dependencies.onRepair(repairs.length);
  }, [options.documents, options.enabled]);
}
