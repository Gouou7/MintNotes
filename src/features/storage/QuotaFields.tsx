import { useId } from "react";
import { useI18n } from "../../i18n";

const MIB = 1048576;
const TOTAL_PRESETS = [100, 200, 500, 1024, 2048] as const;
export const HISTORY_QUOTA_PRESETS = [100, 200, 500] as const;
export interface QuotaDraft { mode: "inherit" | "limited" | "unlimited"; mib: string; custom?: boolean; }
export function quotaDraft(mode: QuotaDraft["mode"], bytes: number | null): QuotaDraft {
  return { mode, mib: String(Math.max(1, Math.ceil((bytes ?? 256 * MIB) / MIB))) };
}
export function quotaPayload(draft: QuotaDraft) {
  if (draft.mode !== "limited") return { mode: draft.mode, bytes: null };
  const mib = Number(draft.mib);
  if (!Number.isSafeInteger(mib) || mib <= 0 || !Number.isSafeInteger(mib * MIB)) throw new Error("Invalid storage quota");
  return { mode: draft.mode, bytes: mib * MIB };
}
export function QuotaFields({ value, onChange, defaultBytes, presets = TOTAL_PRESETS, disabled = false, label }: {
  value: QuotaDraft; onChange: (value: QuotaDraft) => void; defaultBytes?: number;
  presets?: readonly number[]; disabled?: boolean; label: string;
}) {
  const { t } = useI18n();
  const id = useId();
  // Existing inherited quotas retain their policy until the user chooses a capacity.
  const mib = value.mode === "inherit" && defaultBytes !== undefined ? String(Math.max(1, Math.ceil(defaultBytes / MIB))) : value.mib;
  const selected = value.mode === "unlimited" ? "unlimited" : value.custom || !presets.includes(Number(mib)) ? "custom" : mib;
  return <div className="quota-fields">
    <label htmlFor={id}>{label}</label>
    <div className="quota-controls">
      <select id={id} disabled={disabled} value={selected} onChange={(event) => {
        const option = event.target.value;
        onChange(option === "unlimited" ? { ...value, mode: "unlimited", custom: false }
          : { mode: "limited", mib: option === "custom" ? mib : option, custom: option === "custom" });
      }}>
        <option value="unlimited">{t("storage.unlimited")}</option>
        {presets.map(capacity => <option key={capacity} value={capacity}>{capacity >= 1024 ? `${capacity / 1024}GiB` : `${capacity}MiB`}</option>)}
        <option value="custom">{t("storage.customLimit")}</option>
      </select>
      {selected === "custom" && <span className="quota-custom">
        <input type="number" inputMode="numeric" aria-label={t("storage.capacityMiB")} min={1} max={Math.floor(Number.MAX_SAFE_INTEGER / MIB)} step={1} required disabled={disabled} value={mib} onChange={(event) => onChange({ mode: "limited", mib: event.target.value, custom: true })} />
        <span aria-hidden="true">MiB</span>
      </span>}
    </div>
  </div>;
}
