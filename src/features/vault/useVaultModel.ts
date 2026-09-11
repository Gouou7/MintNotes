import { useRef, useState } from "react";
import type { OpenAttachment, OpenDocument } from "../../types";

export function useVaultModel() {
  const [documents, setDocuments] = useState<OpenDocument[]>([]);
  const documentsRef = useRef<OpenDocument[]>([]);
  const documentIndexRef = useRef(new Map<string, OpenDocument>());
  const documentPositionRef = useRef(new Map<string, number>());
  const [attachments, setAttachments] = useState<OpenAttachment[]>([]);
  const attachmentsRef = useRef<OpenAttachment[]>([]);
  const attachmentIndexRef = useRef(new Map<string, OpenAttachment>());
  const attachmentPositionRef = useRef(new Map<string, number>());

  const replaceDocuments = (
    next: OpenDocument[] | ((current: OpenDocument[]) => OpenDocument[])
  ) => {
    const value = typeof next === "function" ? next(documentsRef.current) : next;
    documentsRef.current = value;
    documentIndexRef.current = new Map(value.map((entry) => [entry.objectId, entry]));
    documentPositionRef.current = new Map(value.map((entry, index) => [entry.objectId, index]));
    setDocuments(value);
  };

  const replaceAttachments = (
    next: OpenAttachment[] | ((current: OpenAttachment[]) => OpenAttachment[])
  ) => {
    const value = typeof next === "function" ? next(attachmentsRef.current) : next;
    attachmentsRef.current = value;
    attachmentIndexRef.current = new Map(value.map((entry) => [entry.objectId, entry]));
    attachmentPositionRef.current = new Map(value.map((entry, index) => [entry.objectId, index]));
    setAttachments(value);
  };

  const upsertDocument = (document: OpenDocument) => {
    const current = documentsRef.current;
    const index = documentPositionRef.current.get(document.objectId);
    const value = index === undefined ? [...current, document] : current.slice();
    if (index === undefined) {
      documentPositionRef.current.set(document.objectId, current.length);
    } else {
      value[index] = document;
    }
    documentsRef.current = value;
    documentIndexRef.current.set(document.objectId, document);
    setDocuments(value);
  };

  const upsertAttachment = (attachment: OpenAttachment) => {
    const current = attachmentsRef.current;
    const index = attachmentPositionRef.current.get(attachment.objectId);
    const value = index === undefined ? [...current, attachment] : current.slice();
    if (index === undefined) {
      attachmentPositionRef.current.set(attachment.objectId, current.length);
    } else {
      value[index] = attachment;
    }
    attachmentsRef.current = value;
    attachmentIndexRef.current.set(attachment.objectId, attachment);
    setAttachments(value);
  };

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
