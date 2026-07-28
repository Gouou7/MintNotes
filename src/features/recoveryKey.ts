export function downloadRecoveryKey(username: string, code: string) {
  const url = URL.createObjectURL(new Blob([
    `Mint Notes recovery key for @${username}\n\n${code}\n\nStore this file in a secure location.\n`
  ], { type: "text/plain;charset=utf-8" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `mint-notes-recovery-key-${username}.txt`;
  anchor.click();
  URL.revokeObjectURL(url);
}
