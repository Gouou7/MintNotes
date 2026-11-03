import { formatHistoryBytes } from "../history";

interface StorageCategory {
  label: string;
  bytes: number;
  tone: "notes" | "attachments" | "history" | "avatar" | "trash";
}

/** Categories must be disjoint so every byte occupies exactly one segment. */
export function StorageBreakdown({ label, totalBytes, categories }: {
  label: string;
  totalBytes: number;
  categories: readonly StorageCategory[];
}) {
  return <div className="storage-breakdown">
    <p className="storage-breakdown-label">{label}</p>
    <div className="storage-composition" aria-hidden="true">
      {categories.filter(({ bytes }) => bytes > 0).map(({ label, tone, bytes }) => <span className={`storage-tone-${tone}`} key={label} style={{ width: `${totalBytes > 0 ? bytes / totalBytes * 100 : 0}%` }} />)}
    </div>
    <dl className="storage-categories">
      {categories.map(({ label, tone, bytes }) => <div className="storage-count-item" key={label}><dt><span className={`storage-dot storage-tone-${tone}`} aria-hidden="true" />{label}</dt><dd>{formatHistoryBytes(bytes)}</dd></div>)}
    </dl>
  </div>;
}
