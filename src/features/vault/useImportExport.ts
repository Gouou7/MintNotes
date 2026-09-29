import { useEffect, useRef, useState } from "react";
import type { OpenAttachment, OpenDocument } from "../../types";
import type { Translate } from "../../i18n";
import type { ToastTone } from "../../components/Toast";
import { exportMarkdownZip, exportSingleMarkdown } from "../importExport";
import { importFiles, ImportFailure, type ImportNote, type ImportResult } from "../importPlan";
import { imageAttachmentId, markdownImages } from "../markdownImages";
import { selectionRoots } from "../tree";
import type { NameReservations } from "../siblingNames";
import { makeDocument } from "./documentFactory";
import { persistImportedDocument } from "./importPersistence";

interface Options {
  userId: string;
  getDocuments: () => OpenDocument[];
  getAttachments: () => OpenAttachment[];
  reservations: NameReservations;
  isActive: () => boolean;
  readAttachment: (attachment: OpenAttachment, isActive: () => boolean, signal: AbortSignal) => Promise<Blob>;
  publish: (document: OpenDocument, attachments: OpenAttachment[]) => void;
  onImported: (objectId: string) => void | Promise<void>;
  onResult: () => void;
  notify: (text: string, tone?: ToastTone) => void;
  t: Translate;
}
export function useImportExport(options: Options) {
  const current = useRef(options);
  current.current = options;
  const epoch = useRef(0);
  const tasks = useRef(new Map<Promise<void>, AbortController>());
  const importing = useRef(false);
  const suspended = useRef(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  useEffect(() => () => {
    epoch.current += 1;
    for (const controller of tasks.current.values()) controller.abort();
  }, []);
  const run = (operation: (isActive: () => boolean, signal: AbortSignal) => Promise<void>) => {
    if (suspended.current || !current.current.isActive()) return Promise.resolve();
    const generation = epoch.current;
    const isActive = () => generation === epoch.current && current.current.isActive();
    const controller = new AbortController();
    const task = operation(isActive, controller.signal).finally(() => tasks.current.delete(task));
    tasks.current.set(task, controller);
    return task;
  };
  const handleImport = (files: File[]) => {
    if (!files.length || importing.current || suspended.current || !current.current.isActive()) return Promise.resolve();
    importing.current = true;
    return run(async (isActive, signal) => {
      const { t, notify } = current.current;
      setResult(null);
      notify(t("notice.importing"), "info");
      const create = async (kind: "note" | "folder", title: string, parentId: string | null, note?: ImportNote) => {
        const dependencies = current.current;
        let document = makeDocument(dependencies.getDocuments(), kind, title.trim() || t(kind === "note" ? "app.untitled" : "app.newFolder"), parentId, note?.markdown);
        document = dependencies.reservations.reserve(dependencies.getDocuments(), document);
        try {
          const persisted = await persistImportedDocument(dependencies.userId, document, note, isActive);
          if (isActive()) dependencies.publish(persisted.document, persisted.attachments);
          return { objectId: document.objectId, title: document.title };
        } finally { dependencies.reservations.release(document.objectId); }
      };
      try {
        let outcome: ImportResult;
        try {
          outcome = await importFiles(files, {
            createFolder: (title, parentId) => create("folder", title, parentId),
            createNote: (note, parentId) => create("note", note.title, parentId, note), isActive, signal,
            onProgress: (completed, total) => {
              if (isActive() && (completed === 1 || completed % 25 === 0 || completed === total)) notify(t("transfer.progress", { completed, total }), "info");
            }
          });
        } catch (error) {
          outcome = { completed: [], warnings: [], failure: error instanceof ImportFailure ? error.issue : { source: "", code: "archiveInvalid" }, pending: files.map((file) => file.name) };
        }
        if (!isActive()) return;
        let selectionFailed = false;
        const firstNote = outcome.completed.find((entry) => entry.kind === "note");
        if (firstNote) {
          try { await current.current.onImported(firstNote.objectId); }
          catch { selectionFailed = true; }
        }
        if (!isActive()) return;
        current.current.onResult();
        setResult(outcome);
        const count = outcome.completed.filter((entry) => entry.kind === "note").length;
        const attention = !!outcome.failure || outcome.warnings.length > 0;
        if (selectionFailed) notify(t("notice.localSaveFailed"), "critical");
        else notify(t(attention ? "transfer.completedWithIssues" : "notice.imported", { count }), outcome.failure ? "critical" : attention ? "warning" : "info");
      } finally { importing.current = false; }
    });
  };
  const exportSelection = (ids: string[] | null) => run(async (isActive, signal) => {
    const { t, notify } = current.current;
    const documents = current.current.getDocuments();
    const roots = ids ? selectionRoots(documents, ids) : [];
    if (ids && !roots.length) return;
    const root = roots.length === 1 ? documents.find((entry) => entry.objectId === roots[0]) : undefined;
    const prompt = roots.length > 1 ? t("notice.exportSelectionConfirm", { count: roots.length }) : t("notice.exportConfirm", { label: root ? `“${root.title}”` : t("notice.allNotes") });
    if (!window.confirm(prompt) || !isActive()) return;
    try {
      if (root?.kind === "note" && !markdownImages(root.markdown).some((image) => imageAttachmentId(image.url))) {
        exportSingleMarkdown(root);
      } else {
        await exportMarkdownZip(documents, current.current.getAttachments(), (attachment) => current.current.readAttachment(attachment, isActive, signal), ids ? roots : null, isActive);
      }
    } catch {
      if (isActive()) notify(t("transfer.exportFailed"), "critical");
    }
  });
  return {
    result, dismiss: () => setResult(null), handleImport,
    exportRoot: (objectId: string | null = null) => exportSelection(objectId ? [objectId] : null),
    exportDocuments: (objectIds: string[]) => exportSelection(objectIds),
    resume: () => { suspended.current = false; },
    cancel: async () => {
      suspended.current = true;
      epoch.current += 1;
      setResult(null);
      for (const controller of tasks.current.values()) controller.abort();
      await Promise.allSettled([...tasks.current.keys()]);
    }
  };
}
