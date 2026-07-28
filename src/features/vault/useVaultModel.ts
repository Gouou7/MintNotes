import { useRef, useState } from "react";
import type { OpenAttachment, OpenDocument } from "../../types";

export function useVaultModel() {
  const [documents, setDocuments] = useState<OpenDocument[]>([]);
  const documentsRef = useRef<OpenDocument[]>([]);
  const documentIndexRef = useRef(new Map<string, OpenDocument>());
  const [attachments, setAttachments] = useState<OpenAttachment[]>([]);
  const attachmentsRef = useRef<OpenAttachment[]>([]);
  const attachmentIndexRef = useRef(new Map<string, OpenAttachment>());

  const replaceDocuments = (
    next: OpenDocument[] | ((current: OpenDocument[]) => OpenDocument[])
  ) => {
    const value = typeof next === "function" ? next(documentsRef.current) : next;
    documentsRef.current = value;
    documentIndexRef.current = new Map(value.map((entry) => [entry.objectId, entry]));
    setDocuments(value);
  };

  const replaceAttachments = (
    next: OpenAttachment[] | ((current: OpenAttachment[]) => OpenAttachment[])
  ) => {
    const value = typeof next === "function" ? next(attachmentsRef.current) : next;
    attachmentsRef.current = value;
    attachmentIndexRef.current = new Map(value.map((entry) => [entry.objectId, entry]));
    setAttachments(value);
  };

  const upsertDocument = (document: OpenDocument) => replaceDocuments((current) => (
    documentIndexRef.current.has(document.objectId)
      ? current.map((entry) => entry.objectId === document.objectId ? document : entry)
      : [...current, document]
  ));

  const upsertAttachment = (attachment: OpenAttachment) => replaceAttachments((current) => (
    attachmentIndexRef.current.has(attachment.objectId)
      ? current.map((entry) => entry.objectId === attachment.objectId ? attachment : entry)
      : [...current, attachment]
  ));

  return {
    documents,
    documentsRef,
    documentIndexRef,
    attachments,
    attachmentsRef,
    attachmentIndexRef,
    replaceDocuments,
    replaceAttachments,
    upsertDocument,
    upsertAttachment
  };
}
