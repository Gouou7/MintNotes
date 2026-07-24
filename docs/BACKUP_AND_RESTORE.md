# Backup and restore

Server backups protect account records, key envelopes, trash/history-retention settings, encrypted profile avatars, trusted-endpoint and session history, encrypted objects, synchronization revisions, encrypted note history, clear markers, synchronization changes, activation records, and encrypted attachment chunks. They do not contain note, historical-note, avatar, or attachment plaintext, but they remain sensitive because they expose account, endpoint, IP, activity, history timing/type, and ciphertext-size metadata plus material for offline password guessing.

A backup strategy needs both layers:

- **Encrypted server backup:** preserves accounts, synchronization state, revisions, note-history ciphertext, and attachment ciphertext.
- **Plaintext Markdown ZIP export:** preserves portable, human-readable notes and folder structure independently of the application.

Keep recovery keys separately. Neither backup layer can replace a lost recovery key and forgotten password by itself.

## Create a consistent online backup

The application backup command uses SQLite's online-backup API and is safe while the service accepts writes:

```bash
docker compose exec notes pnpm backup
```

It creates `/data/backups/mint-notes-<timestamp>.sqlite` and prints JSON containing the path and SHA-256 digest. Copy the named file out of the Docker volume:

```bash
mkdir -p backups
docker compose cp notes:/data/backups/mint-notes-YYYY-MM-DDTHH-MM-SS-sssZ.sqlite ./backups/
```

Verify the copied file against the printed digest with the SHA-256 tool available on the backup host. Store the digest separately from the backup.

Do not copy a live `notes.sqlite` file directly. The database uses WAL mode, so a file-level copy can omit committed transactions still represented by the WAL.

## Retention and storage

A practical starting policy is:

- Seven daily backups.
- Four weekly backups.
- Twelve monthly backups.
- At least one encrypted copy outside the application server and Docker volume.

Adjust retention to the amount of acceptable data loss and available storage. Protect backup access, encrypt off-server media, and periodically test that old generations are still readable.

Plaintext Markdown ZIP exports must be stored in an independently encrypted location. They are intentionally readable and are outside the application's E2EE boundary.

## Restore drill

Always test restoration on a separate deployment first. A restore is successful only after representative users can decrypt notes and attachments—not merely when SQLite opens.

1. Select a backup and verify its recorded SHA-256 digest.
2. Prepare a clean Mint Notes deployment with an empty data volume.
3. Keep the `notes` service stopped while placing the backup at `/data/notes.sqlite` in that volume.
4. Start the service and confirm `GET /api/health` returns `{"ok":true}`.
5. Test normal login for more than one account.
6. Test recovery-key password reset on a designated test account.
7. Open representative folders and notes, then verify revision synchronization on a second browser.
8. Download representative attachments, verify they decrypt, and create a fresh Markdown ZIP export.
9. Confirm administrators can still create activation codes and inspect account storage without seeing note plaintext.
10. Open **Settings > Security** and confirm trusted-endpoint history is readable; revoke a designated test endpoint that satisfies the 24-hour rule and verify all of its sessions stop working.
11. Confirm an encrypted profile avatar decrypts after restore, then perform administrator deletion only on a disposable test user and verify another user's data remains available.
12. Open a representative note's **History** panel, decrypt a historical preview, restore it as a copy, and confirm the original note and its history remain intact.

If the restored service reports an unsupported or legacy schema, do not force the database open or edit `PRAGMA user_version`. Return to the compatible application build or restore through portable Markdown exports as described in the [deployment guide](DEPLOYMENT.md).

## Production replacement

Before replacing a live production volume:

1. Create and copy out one final online backup.
2. Stop the service to prevent further writes.
3. Preserve the old volume until the replacement passes the complete restore drill.
4. Start the replacement and monitor login, synchronization, attachment download, and backup creation.

Do not delete the pre-restore backup or old volume merely because the service reached a healthy HTTP state.
