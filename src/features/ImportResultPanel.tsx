import { AppDialog } from "../components/AppDialog";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "../components/ui/collapsible";
import { Table, TableHeader, TableHead, TableBody, TableRow, TableCell } from "../components/ui/table";
import { useI18n } from "../i18n";
import type { ImportIssue, ImportResult } from "./importPlan";

export function ImportResultPanel({ result, onClose }: { result: ImportResult; onClose: () => void }) {
  const { t } = useI18n();
  const renamed = result.completed.filter((entry) => entry.title !== entry.originalTitle);
  const describe = (issue: ImportIssue) => <><strong>{issue.source}</strong>{issue.reference && <code>{issue.reference}</code>}<span>{t(`transfer.issue.${issue.code}`)}</span></>;
  return <AppDialog className="import-result" title={t("transfer.resultTitle")} onClose={onClose}>
    <div className="import-result-body">
      <p>{t("transfer.summary", { notes: result.completed.filter((entry) => entry.kind === "note").length, folders: result.completed.filter((entry) => entry.kind === "folder").length, warnings: result.warnings.length, pending: result.pending.length })}</p>
      {result.failure && <p role="alert" className="import-result-issue">{describe(result.failure)}</p>}
      {!!renamed.length && <Collapsible defaultOpen><CollapsibleTrigger>{t("transfer.renamed", { count: renamed.length })}</CollapsibleTrigger><CollapsibleContent><Table><TableHeader><TableRow><TableHead>{t("transfer.source")}</TableHead><TableHead>{t("transfer.originalName")}</TableHead><TableHead>{t("transfer.finalName")}</TableHead></TableRow></TableHeader><TableBody>{renamed.map((entry) => <TableRow key={entry.objectId}><TableCell>{entry.source}</TableCell><TableCell>{entry.originalTitle}</TableCell><TableCell>{entry.title}</TableCell></TableRow>)}</TableBody></Table></CollapsibleContent></Collapsible>}
      {!!result.warnings.length && <Collapsible defaultOpen><CollapsibleTrigger>{t("transfer.warnings", { count: result.warnings.length })}</CollapsibleTrigger><CollapsibleContent><ul>{result.warnings.map((issue, index) => <li className="import-result-issue" key={index}>{describe(issue)}</li>)}</ul></CollapsibleContent></Collapsible>}
      {!!result.pending.length && <Collapsible><CollapsibleTrigger>{t("transfer.pending", { count: result.pending.length })}</CollapsibleTrigger><CollapsibleContent><ul>{result.pending.map((source, index) => <li key={index}>{source}</li>)}</ul></CollapsibleContent></Collapsible>}
    </div>
  </AppDialog>;
}
