import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { useI18n } from "../i18n";
import {
  AlertDialog, AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle
} from "./ui/alert-dialog";
import { Button } from "./ui/button";

export interface ConfirmationOptions {
  title: string;
  message: string;
  action: string;
  destructive?: boolean;
}

export type RequestConfirmation = (options: ConfirmationOptions, signal?: AbortSignal) => Promise<boolean>;

interface PendingConfirmation extends ConfirmationOptions {
  finish: (accepted: boolean) => void;
}

export function useConfirmation() {
  const [current, setCurrent] = useState<PendingConfirmation | null>(null);
  const pending = useRef<PendingConfirmation | null>(null);
  const mounted = useRef(true);
  const cancel = useCallback(() => pending.current?.finish(false), []);
  useLayoutEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      cancel();
    };
  }, [cancel]);

  const request = useCallback<RequestConfirmation>((options, signal) => {
    if (!mounted.current || pending.current || signal?.aborted) return Promise.resolve(false);
    return new Promise((resolve) => {
      const abort = () => entry.finish(false);
      const entry: PendingConfirmation = {
        ...options,
        finish(accepted) {
          if (pending.current !== entry) return;
          pending.current = null;
          signal?.removeEventListener("abort", abort);
          if (mounted.current) setCurrent(null);
          resolve(accepted);
        }
      };
      pending.current = entry;
      signal?.addEventListener("abort", abort, { once: true });
      setCurrent(entry);
    });
  }, []);
  return { request, cancel, current };
}

export function Confirmation({ current }: { current: PendingConfirmation | null }) {
  const { t } = useI18n();
  const cancelButton = useRef<HTMLButtonElement>(null);
  if (!current) return null;
  return <AlertDialog open onOpenChange={(open) => { if (!open) current.finish(false); }}>
    <AlertDialogContent initialFocus={cancelButton}>
      <AlertDialogHeader>
        <AlertDialogTitle>{current.title}</AlertDialogTitle>
        <AlertDialogDescription>{current.message}</AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <Button ref={cancelButton} variant="outline" onClick={() => current.finish(false)}>{t("common.cancel")}</Button>
        <Button variant={current.destructive ? "destructive" : "default"} onClick={() => current.finish(true)}>{current.action}</Button>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>;
}
