import { useEffect, useRef } from "react";
import { X } from "lucide-react";
import { AppIcon } from "../components/AppIcon";
import { useI18n } from "../i18n";
import type { ImportIssue, ImportResult } from "./importPlan";

export function ImportResultPanel({ result, onClose }: { result: ImportResult; onClose: () => void }) {
  const { t } = useI18n();
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current!;
    element.showModal();
    return () => element.close();
  }, []);
  const renamed = result.completed.filter((entry) => entry.title !== entry.originalTitle);
  const describe = (issue: ImportIssue) => <><strong>{issue.source}</strong>{issue.reference && <code>{issue.reference}</code>}<span>{t(`transfer.issue.${issue.code}`)}</span></>;
  return <dialog ref={dialog} className="import-result" aria-labelledby="import-result-title" onCancel={(event) => { event.preventDefault(); onClose(); }}>
    <header><h2 id="import-result-title">{t("transfer.resultTitle")}</h2><button type="button" onClick={onClose} aria-label={t("common.close")}><AppIcon icon={X} size={18} /></button></header>
    <div className="import-result-body">
      <p>{t("transfer.summary", { notes: result.completed.filter((entry) => entry.kind === "note").length, folders: result.completed.filter((entry) => entry.kind === "folder").length, warnings: result.warnings.length, pending: result.pending.length })}</p>
      {result.failure && <p role="alert" className="import-result-issue">{describe(result.failure)}</p>}
      {!!renamed.length && <details open><summary>{t("transfer.renamed", { count: renamed.length })}</summary><table><thead><tr><th>{t("transfer.source")}</th><th>{t("transfer.originalName")}</th><th>{t("transfer.finalName")}</th></tr></thead><tbody>{renamed.map((entry) => <tr key={entry.objectId}><td>{entry.source}</td><td>{entry.originalTitle}</td><td>{entry.title}</td></tr>)}</tbody></table></details>}
      {!!result.warnings.length && <details open><summary>{t("transfer.warnings", { count: result.warnings.length })}</summary><ul>{result.warnings.map((issue, index) => <li className="import-result-issue" key={index}>{describe(issue)}</li>)}</ul></details>}
      {!!result.pending.length && <details><summary>{t("transfer.pending", { count: result.pending.length })}</summary><ul>{result.pending.map((source, index) => <li key={index}>{source}</li>)}</ul></details>}
    </div>
  </dialog>;
}
