import { useEffect, useRef, useState } from "react";
import type { OpenAttachment } from "../../types";
import { decryptAttachmentBlob } from "../attachments";

type CachedAttachmentUrl = { signature: string; url: string };

function attachmentDisplaySignature(attachment: OpenAttachment): string {
  return [
    attachment.objectId,
    attachment.deleted,
    attachment.updatedAt,
    attachment.sha256
  ].join(":");
}

export function attachmentGraphSignature(
  attachmentIds: readonly string[],
  attachmentIndex: ReadonlyMap<string, OpenAttachment>
): string {
  return attachmentIds.map((id) => {
    const attachment = attachmentIndex.get(id);
    return attachment ? attachmentDisplaySignature(attachment) : `${id}:missing`;
  }).join("|");
}

export function useAttachmentUrls(options: {
  userId: string;
  activeDocumentId: string | null;
  attachmentIds: readonly string[];
  signature: string;
  attachments: { current: OpenAttachment[] };
  isActive: () => boolean;
  onError: (error: unknown) => void;
}) {
  const [urls, setUrls] = useState<Map<string, string>>(new Map());
  const cache = useRef<Map<string, CachedAttachmentUrl>>(new Map());

  useEffect(() => {
    let cancelled = false;
    const createdUrls: string[] = [];
    void (async () => {
      const previous = cache.current;
      const nextCache = new Map<string, CachedAttachmentUrl>();
      const nextUrls = new Map<string, string>();
      for (const id of options.attachmentIds) {
        const normalizedId = id.toLowerCase();
        const attachment = options.attachments.current.find(
          (entry) => entry.objectId === id && !entry.deleted
        );
        if (!attachment) continue;
        const signature = attachmentDisplaySignature(attachment);
        const cached = previous.get(normalizedId);
        if (cached?.signature === signature) {
          nextCache.set(normalizedId, cached);
          nextUrls.set(normalizedId, cached.url);
          continue;
        }
        try {
          const blob = await decryptAttachmentBlob(
            options.userId,
            attachment,
            options.isActive
          );
          const url = URL.createObjectURL(blob);
          if (cancelled) {
            URL.revokeObjectURL(url);
            continue;
          }
          createdUrls.push(url);
          const entry = { signature, url };
          nextCache.set(normalizedId, entry);
          nextUrls.set(normalizedId, url);
        } catch (error) {
          if (!cancelled) options.onError(error);
        }
      }
      if (cancelled) return;
      for (const [id, cached] of previous) {
        if (nextCache.get(id)?.url !== cached.url) URL.revokeObjectURL(cached.url);
      }
      cache.current = nextCache;
      setUrls(nextUrls);
    })();
    return () => {
      cancelled = true;
      for (const url of createdUrls) {
        if (![...cache.current.values()].some((entry) => entry.url === url)) {
          URL.revokeObjectURL(url);
        }
      }
    };
  }, [options.activeDocumentId, options.signature]);

  useEffect(() => () => {
    for (const cached of cache.current.values()) URL.revokeObjectURL(cached.url);
    cache.current.clear();
  }, []);

  return { urls, cache };
}
