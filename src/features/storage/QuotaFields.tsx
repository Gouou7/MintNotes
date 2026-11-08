import { InputGroup, InputGroupAddon, InputGroupInput, InputGroupText } from "@/components/ui/input-group";
import { Select } from "@/components/ui/select";
import { SettingsItem } from "../../components/SettingsItem";
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
export function QuotaFields({ value, onChange, defaultBytes, presets = TOTAL_PRESETS, disabled = false, label, description }: {
  value: QuotaDraft; onChange: (value: QuotaDraft) => void; defaultBytes?: number;
  presets?: readonly number[]; disabled?: boolean; label: string; description?: string;
}) {
  const { t } = useI18n();
  // Existing inherited quotas retain their policy until the user chooses a capacity.
  const mib = value.mode === "inherit" && defaultBytes !== undefined ? String(Math.max(1, Math.ceil(defaultBytes / MIB))) : value.mib;
  const selected = value.mode === "unlimited" ? "unlimited" : value.custom || !presets.includes(Number(mib)) ? "custom" : mib;
  return <SettingsItem title={label} description={description} className="quota-fields">{(control) =>
    <div className="quota-controls">
      <Select {...control} disabled={disabled} value={selected} items={[
        { value: "unlimited", label: t("storage.unlimited") },
        ...presets.map((capacity) => ({ value: String(capacity), label: capacity >= 1024 ? `${capacity / 1024}GiB` : `${capacity}MiB` })),
        { value: "custom", label: t("storage.customLimit") }
      ]} onValueChange={(option) => {
        onChange(option === "unlimited" ? { ...value, mode: "unlimited", custom: false }
          : { mode: "limited", mib: option === "custom" ? mib : option, custom: option === "custom" });
      }} />
      {selected === "custom" && <InputGroup className="quota-custom">
        <InputGroupInput type="number" inputMode="numeric" aria-label={t("storage.capacityMiB")} min={1} max={Math.floor(Number.MAX_SAFE_INTEGER / MIB)} step={1} required disabled={disabled} value={mib} onChange={(event) => onChange({ mode: "limited", mib: event.target.value, custom: true })} />
        <InputGroupAddon align="inline-end" aria-hidden="true"><InputGroupText>MiB</InputGroupText></InputGroupAddon>
      </InputGroup>}
    </div>}
  </SettingsItem>;
}
