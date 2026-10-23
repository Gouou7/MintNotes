import { useEffect, useRef, useState } from "react";
import { api } from "../../api";
import { cryptoClient, type EncryptedProfileAvatar } from "../../crypto/client";

interface Options {
  serverSessionVerified: boolean;
  userId: string;
}

/** 账户头像的解密与临时 URL 生命周期。 */
export function useVaultProfile(options: Options) {
  const { serverSessionVerified, userId } = options;

  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);

  const avatarUrlRef = useRef<string | null>(null);

  const updateAvatarUrl = (avatar: { mime: string; data: ArrayBuffer } | null) => {
    if (avatarUrlRef.current) URL.revokeObjectURL(avatarUrlRef.current);
    const next = avatar ? URL.createObjectURL(new Blob([avatar.data], { type: avatar.mime })) : null;
    avatarUrlRef.current = next;
    setAvatarUrl(next);
  };

  useEffect(() => {
    let cancelled = false;
    if (!serverSessionVerified) {
      updateAvatarUrl(null);
      return () => { cancelled = true; };
    }
    void api<{ avatar: (EncryptedProfileAvatar & { updatedAt: string }) | null }>("/api/account/avatar")
      .then(async ({ avatar }) => avatar ? cryptoClient.decryptProfileAvatar(userId, avatar) : null)
      .then((avatar) => { if (!cancelled) updateAvatarUrl(avatar); })
      .catch(() => undefined);
    return () => {
      cancelled = true;
      if (avatarUrlRef.current) URL.revokeObjectURL(avatarUrlRef.current);
      avatarUrlRef.current = null;
    };
  }, [serverSessionVerified, userId]);

  return { avatarUrl, updateAvatarUrl };
}
