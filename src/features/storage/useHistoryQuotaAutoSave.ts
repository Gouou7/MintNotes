import { useCallback, useEffect, useRef, useState } from "react";
import { quotaDraft, quotaPayload, type QuotaDraft } from "./QuotaFields";

const fromQuota = (bytes: number | null) => quotaDraft(bytes === null ? "unlimited" : "limited", bytes);

export function useHistoryQuotaAutoSave(quotaBytes: number | null, busy: boolean, online: boolean,
  update: (patch: { quotaBytes: number | null }) => Promise<boolean>) {
  const [draft, setDraft] = useState(() => fromQuota(quotaBytes));
  const [pending, setPending] = useState(false);
  const [saving, setSaving] = useState(false);
  const confirmed = useRef(quotaBytes);
  const active = useRef(true);
  const running = useRef(false);
  const revision = useRef(0);
  const current = useRef({ draft, pending, busy, online, update });
  current.current = { draft, pending, busy, online, update };

  useEffect(() => {
    active.current = true;
    return () => { active.current = false; };
  }, []);
  useEffect(() => {
    confirmed.current = quotaBytes;
    if (!current.current.pending && !running.current) setDraft(value => {
      try { if (quotaPayload(value).bytes === quotaBytes) return value; } catch { /* Replace an invalid draft. */ }
      return fromQuota(quotaBytes);
    });
  }, [quotaBytes]);
  useEffect(() => {
    if (!online) { setPending(false); setDraft(fromQuota(confirmed.current)); }
  }, [online]);

  const flush = useCallback(async () => {
    const state = current.current;
    if (!active.current || !state.pending || state.busy || !state.online || running.current) return;
    let bytes: number | null;
    try { bytes = quotaPayload(state.draft).bytes; } catch { return; }
    current.current.pending = false;
    setPending(false);
    if (bytes === confirmed.current) return;
    const sentRevision = revision.current;
    running.current = true;
    setSaving(true);
    try {
      const saved = await state.update({ quotaBytes: bytes });
      if (!active.current) return;
      if (saved) confirmed.current = bytes;
      else if (revision.current === sentRevision) setDraft(fromQuota(confirmed.current));
    } catch {
      if (active.current && revision.current === sentRevision) setDraft(fromQuota(confirmed.current));
    } finally {
      running.current = false;
      if (active.current) setSaving(false);
    }
  }, []);

  useEffect(() => {
    if (!pending || busy || saving || !online) return;
    const timer = setTimeout(() => void flush(), draft.custom ? 500 : 0);
    return () => clearTimeout(timer);
  }, [draft, pending, busy, saving, online, flush]);

  const change = (value: QuotaDraft) => {
    ++revision.current;
    current.current = { ...current.current, draft: value, pending: true };
    setDraft(value);
    setPending(true);
    if (!value.custom) void flush();
  };
  return { draft, change, flush, saving };
}
