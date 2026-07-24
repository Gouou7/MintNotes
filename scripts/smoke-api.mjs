import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";

const dataDirectory = await mkdtemp(join(tmpdir(), "mint-notes-smoke-"));
const port = 8790;
const baseUrl = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, ["server-dist/index.js"], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    HOST: "127.0.0.1",
    PORT: String(port),
    MINT_NOTES_SMOKE_STORAGE_PATH: dataDirectory,
    ALLOW_REGISTRATION: "true",
    NODE_ENV: "development"
  },
  stdio: ["ignore", "pipe", "pipe"]
});

let serverError = "";
server.stderr.on("data", (chunk) => { serverError += chunk.toString(); });

async function waitUntilReady() {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.ok) return;
    } catch {
      // The child process is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Server did not become ready. ${serverError}`);
}

function responseCookies(response) {
  const values = typeof response.headers.getSetCookie === "function" ? response.headers.getSetCookie() : [response.headers.get("set-cookie")].filter(Boolean);
  return Object.fromEntries(values.map((value) => value.split(";", 1)[0].split(/=(.*)/s).slice(0, 2)));
}

function cookieHeader(cookies) {
  return Object.entries(cookies).map(([name, value]) => `${name}=${value}`).join("; ");
}

async function register(username, authSecret, userAgent = "Mint Notes smoke browser") {
  const response = await fetch(`${baseUrl}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "User-Agent": userAgent },
    body: JSON.stringify({
      username,
      displayName: username,
      authSecret,
      kdfSalt: "s".repeat(24),
      kdfParams: { algorithm: "argon2id", opsLimit: 3, memLimit: 67108864, version: 1 },
      wrappedVaultKey: "v".repeat(32),
      wrappedVaultNonce: "n".repeat(24),
      recoveryAuthSecret: `r-${authSecret}`,
      recoveryWrappedVaultKey: "w".repeat(32),
      recoveryWrappedVaultNonce: "q".repeat(24)
    })
  });
  if (!response.ok) throw new Error(`Registration failed: ${await response.text()}`);
  const cookies = responseCookies(response);
  const cookie = cookieHeader(cookies);
  if (!cookie.includes("webmd_session=") || !cookie.includes("webmd_endpoint=")) throw new Error("Registration did not create endpoint and session cookies");
  return { cookie, cookies, body: await response.json() };
}

async function login(username, authSecret, userAgent, existingCookies = {}, rememberDevice = false) {
  const response = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "User-Agent": userAgent, ...(Object.keys(existingCookies).length ? { Cookie: cookieHeader(existingCookies) } : {}) },
    body: JSON.stringify({ username, authSecret, rememberDevice })
  });
  if (!response.ok) throw new Error(`Login failed: ${await response.text()}`);
  const cookies = { ...existingCookies, ...responseCookies(response) };
  const cookie = cookieHeader(cookies);
  if (!cookie.includes("webmd_session=")) throw new Error("Login did not create a session cookie");
  return { cookie, cookies, body: await response.json(), setCookies: response.headers.getSetCookie() };
}

async function putObject(account, objectId, ciphertext) {
  const response = await fetch(`${baseUrl}/api/objects/${objectId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", Cookie: account.cookie },
    body: JSON.stringify({
      objectType: "note",
      ciphertext,
      nonce: "z".repeat(24),
      encryptionVersion: 1,
      baseRevision: 0,
      idempotencyKey: crypto.randomUUID(),
      deleted: false
    })
  });
  if (!response.ok) throw new Error(`Object write failed: ${await response.text()}`);
}

async function pull(account) {
  const response = await fetch(`${baseUrl}/api/sync?since=0`, { headers: { Cookie: account.cookie } });
  if (!response.ok) throw new Error(`Sync failed: ${await response.text()}`);
  return response.json();
}

async function openSyncEvents(account, since, clientId) {
  const controller = new AbortController();
  const response = await fetch(`${baseUrl}/api/sync/events?since=${since}&clientId=${clientId}`, {
    headers: { Cookie: account.cookie },
    signal: controller.signal
  });
  if (!response.ok || !response.body) throw new Error(`SSE connection failed: ${await response.text()}`);
  return { controller, reader: response.body.getReader() };
}

async function waitForChangedEvent(stream, timeoutMs = 2_000) {
  const decoder = new TextDecoder();
  let buffer = "";
  const read = async () => {
    while (true) {
      const next = await stream.reader.read();
      if (next.done) return null;
      buffer += decoder.decode(next.value, { stream: true });
      const events = buffer.split("\n\n");
      buffer = events.pop() ?? "";
      for (const event of events) {
        if (!event.includes("event: changed")) continue;
        const data = event.split("\n").find((line) => line.startsWith("data: "))?.slice(6);
        return data ? JSON.parse(data) : null;
      }
    }
  };
  try {
    return await Promise.race([
      read(),
      new Promise((resolve) => setTimeout(() => resolve(null), timeoutMs))
    ]);
  } finally {
    stream.controller.abort();
  }
}

async function putChunk(account, attachmentId, marker) {
  const response = await fetch(`${baseUrl}/api/attachments/${attachmentId}/chunks/0`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/octet-stream",
      Cookie: account.cookie,
      "X-WebMD-Nonce": "n".repeat(24),
      "X-WebMD-Total-Chunks": "1",
      "X-WebMD-Encryption-Version": "1",
      "X-WebMD-Idempotency-Key": crypto.randomUUID()
    },
    body: new TextEncoder().encode(marker)
  });
  if (!response.ok) throw new Error(`Attachment write failed: ${await response.text()}`);
}

async function getChunk(account, attachmentId) {
  const response = await fetch(`${baseUrl}/api/attachments/${attachmentId}/chunks/0`, { headers: { Cookie: account.cookie } });
  if (!response.ok) throw new Error(`Attachment read failed: ${await response.text()}`);
  return response.text();
}

try {
  await waitUntilReady();
  let alpha = await register("alpha", "alpha-client-derived-secret-000001", "Mozilla/5.0 (Macintosh) Safari/605.1.15");
  const alphaPhone = await login("alpha", "alpha-client-derived-secret-000001", "Mozilla/5.0 (iPhone) CriOS/125.0");
  const bravo = await register("bravo", "bravo-client-derived-secret-000002");
  const firstEndpointId = alpha.body.endpoint.id;
  alpha = await login("alpha", "alpha-client-derived-secret-000001", "Mozilla/5.0 (Macintosh) Safari/605.1.15", alpha.cookies, true);
  const initialEndpointsResponse = await fetch(`${baseUrl}/api/account/endpoints`, { headers: { Cookie: alpha.cookie } });
  const initialEndpoints = await initialEndpointsResponse.json();
  const otherEndpoint = initialEndpoints.endpoints.find((endpoint) => !endpoint.current && endpoint.active);
  const currentEndpoint = initialEndpoints.endpoints.find((endpoint) => endpoint.current);
  const earlyRevokeResponse = await fetch(`${baseUrl}/api/account/endpoints/${otherEndpoint.id}`, { method: "DELETE", headers: { Cookie: alpha.cookie } });
  const smokeDb = new Database(join(dataDirectory, "notes.sqlite"));
  smokeDb.prepare("UPDATE trusted_endpoints SET first_seen_at = ? WHERE endpoint_id = ?").run(
    new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString(), currentEndpoint.id
  );
  smokeDb.close();
  const crossUserRevokeResponse = await fetch(`${baseUrl}/api/account/endpoints/${bravo.body.endpoint.id}`, {
    method: "DELETE",
    headers: { Cookie: alpha.cookie }
  });
  const revokeResponse = await fetch(`${baseUrl}/api/account/endpoints/${otherEndpoint.id}`, { method: "DELETE", headers: { Cookie: alpha.cookie } });
  const revokedDeviceResponse = await fetch(`${baseUrl}/api/auth/me`, { headers: { Cookie: alphaPhone.cookie } });
  const objectId = crypto.randomUUID();
  await putObject(alpha, objectId, "A".repeat(32));
  await putObject(bravo, objectId, "B".repeat(32));
  const attachmentId = crypto.randomUUID();
  await putChunk(alpha, attachmentId, "alpha-encrypted-chunk");
  await putChunk(bravo, attachmentId, "bravo-encrypted-chunk");
  const [syncA, syncB] = await Promise.all([pull(alpha), pull(bravo)]);
  const [chunkA, chunkB] = await Promise.all([getChunk(alpha, attachmentId), getChunk(bravo, attachmentId)]);
  const historyId = crypto.randomUUID();
  const historyCapturedAt = "2026-07-23T10:00:00.000Z";
  const historyEnvelope = {
    capturedAt: historyCapturedAt,
    captureKind: "manual",
    ciphertext: "history-ciphertext-".repeat(16),
    nonce: "h".repeat(24),
    encryptionVersion: 1,
    idempotencyKey: crypto.randomUUID()
  };
  const historyWrite = await fetch(`${baseUrl}/api/notes/${objectId}/history/${historyId}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: alpha.cookie },
    body: JSON.stringify(historyEnvelope)
  });
  const [historyListResponse, crossUserHistoryList, crossUserHistoryRead] = await Promise.all([
    fetch(`${baseUrl}/api/notes/${objectId}/history`, { headers: { Cookie: alpha.cookie } }),
    fetch(`${baseUrl}/api/notes/${objectId}/history`, { headers: { Cookie: bravo.cookie } }),
    fetch(`${baseUrl}/api/notes/${objectId}/history/${historyId}`, { headers: { Cookie: bravo.cookie } })
  ]);
  const historyList = await historyListResponse.json();
  const bravoHistoryList = await crossUserHistoryList.json();
  const historyRead = await fetch(`${baseUrl}/api/notes/${objectId}/history/${historyId}`, { headers: { Cookie: alpha.cookie } });
  const historyClear = await fetch(`${baseUrl}/api/notes/${objectId}/history`, {
    method: "DELETE",
    headers: { Cookie: alpha.cookie }
  });
  const clearedHistoryReplay = await fetch(`${baseUrl}/api/notes/${objectId}/history/${crypto.randomUUID()}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: alpha.cookie },
    body: JSON.stringify({ ...historyEnvelope, idempotencyKey: crypto.randomUUID() })
  });
  const historySettingsUpdate = await fetch(`${baseUrl}/api/account/note-history-settings`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Cookie: alpha.cookie },
    body: JSON.stringify({ enabled: true, intervalMinutes: 30, retentionDays: 180 })
  });
  const historySettings = await historySettingsUpdate.json();
  const sourceClientId = crypto.randomUUID();
  const receiverClientId = crypto.randomUUID();
  const sourceEvents = await openSyncEvents(alpha, syncA.cursor, sourceClientId);
  const receiverEvents = await openSyncEvents(alpha, syncA.cursor, receiverClientId);
  const bravoEvents = await openSyncEvents(bravo, syncB.cursor, crypto.randomUUID());
  const firstBatchObjectId = crypto.randomUUID();
  const secondBatchObjectId = crypto.randomUUID();
  const batchObjects = [firstBatchObjectId, secondBatchObjectId].map((batchObjectId, index) => ({
    objectId: batchObjectId,
    objectType: "note",
    ciphertext: String(index + 1).repeat(32),
    nonce: "b".repeat(24),
    encryptionVersion: 1,
    baseRevision: 0,
    idempotencyKey: crypto.randomUUID(),
    deleted: false
  }));
  const batchResponse = await fetch(`${baseUrl}/api/objects/batch`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: alpha.cookie,
      "X-WebMD-Sync-Client": sourceClientId
    },
    body: JSON.stringify({ objects: batchObjects })
  });
  const batchResult = await batchResponse.json();
  const receiverEvent = await waitForChangedEvent(receiverEvents);
  const [sourceEvent, crossUserEvent] = await Promise.all([
    waitForChangedEvent(sourceEvents, 400),
    waitForChangedEvent(bravoEvents, 400)
  ]);
  const idempotentBatchResponse = await fetch(`${baseUrl}/api/objects/batch`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: alpha.cookie },
    body: JSON.stringify({ objects: batchObjects })
  });
  const idempotentBatch = await idempotentBatchResponse.json();
  const conflictBatchResponse = await fetch(`${baseUrl}/api/objects/batch`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: alpha.cookie },
    body: JSON.stringify({
      objects: [{ ...batchObjects[0], idempotencyKey: crypto.randomUUID(), ciphertext: "c".repeat(32) }]
    })
  });
  const conflictBatch = await conflictBatchResponse.json();
  for (const [baseRevision, marker] of [[1, "d"], [2, "e"]]) {
    const response = await fetch(`${baseUrl}/api/objects/${firstBatchObjectId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", Cookie: alpha.cookie },
      body: JSON.stringify({
        objectType: "note",
        ciphertext: marker.repeat(32),
        nonce: "b".repeat(24),
        encryptionVersion: 1,
        baseRevision,
        idempotencyKey: crypto.randomUUID(),
        deleted: false
      })
    });
    if (!response.ok) throw new Error(`Repeated object update failed: ${await response.text()}`);
  }
  const compactResponse = await fetch(`${baseUrl}/api/sync?since=${syncA.cursor}&limit=500&compact=1`, {
    headers: { Cookie: alpha.cookie }
  });
  const compactSync = await compactResponse.json();
  const setupResponse = await fetch(`${baseUrl}/api/admin/account-setups`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: alpha.cookie },
    body: JSON.stringify({ username: "charlie", displayName: "Charlie", expiresInHours: 72 })
  });
  const setup = await setupResponse.json();
  const activationResponse = await fetch(`${baseUrl}/api/auth/activate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      username: "charlie",
      displayName: "ignored",
      activationCode: setup.activationCode,
      authSecret: "charlie-client-derived-secret-000003",
      kdfSalt: "s".repeat(24),
      kdfParams: { algorithm: "argon2id", opsLimit: 3, memLimit: 67108864, version: 1 },
      wrappedVaultKey: "v".repeat(32),
      wrappedVaultNonce: "n".repeat(24),
      recoveryAuthSecret: "charlie-recovery-secret-000000003",
      recoveryWrappedVaultKey: "w".repeat(32),
      recoveryWrappedVaultNonce: "q".repeat(24)
    })
  });
  const activatedCharlie = activationResponse.ok ? await activationResponse.json() : null;
  const charlie = { cookie: cookieHeader(responseCookies(activationResponse)), body: activatedCharlie };
  const avatarEnvelope = { ciphertext: "avatar-ciphertext-".repeat(24), nonce: "a".repeat(24), encryptionVersion: 1 };
  const avatarUpdate = await fetch(`${baseUrl}/api/account/avatar`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", Cookie: alpha.cookie },
    body: JSON.stringify(avatarEnvelope)
  });
  const [alphaAvatarResponse, bravoAvatarResponse] = await Promise.all([
    fetch(`${baseUrl}/api/account/avatar`, { headers: { Cookie: alpha.cookie } }),
    fetch(`${baseUrl}/api/account/avatar`, { headers: { Cookie: bravo.cookie } })
  ]);
  const [alphaAvatar, bravoAvatar] = await Promise.all([alphaAvatarResponse.json(), bravoAvatarResponse.json()]);
  const recoveryKeyReset = await fetch(`${baseUrl}/api/account/recovery-key`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: alpha.cookie },
    body: JSON.stringify({
      currentAuthSecret: "alpha-client-derived-secret-000001",
      recoveryAuthSecret: "alpha-rotated-recovery-secret-0001",
      recoveryWrappedVaultKey: "R".repeat(32),
      recoveryWrappedVaultNonce: "N".repeat(24)
    })
  });
  const wrongRecoveryKeyReset = await fetch(`${baseUrl}/api/account/recovery-key`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: alpha.cookie },
    body: JSON.stringify({
      currentAuthSecret: "wrong-alpha-client-secret-0000001",
      recoveryAuthSecret: "unused-recovery-secret-000000001",
      recoveryWrappedVaultKey: "R".repeat(32),
      recoveryWrappedVaultNonce: "N".repeat(24)
    })
  });
  const charlieObjectId = crypto.randomUUID();
  if (activationResponse.ok) await putObject(charlie, charlieObjectId, "C".repeat(32));
  const adminUsersBeforeDelete = await fetch(`${baseUrl}/api/admin/users`, { headers: { Cookie: alpha.cookie } });
  const managedBeforeDelete = await adminUsersBeforeDelete.json();
  const charlieUser = managedBeforeDelete.users.find((entry) => entry.username === "charlie");
  const wrongDeletePassword = await fetch(`${baseUrl}/api/admin/users/${charlieUser.id}`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json", Cookie: alpha.cookie },
    body: JSON.stringify({ currentAuthSecret: "wrong-alpha-client-secret-0000001", confirmationUsername: "charlie" })
  });
  const selfDelete = await fetch(`${baseUrl}/api/admin/users/${alpha.body.user.id}`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json", Cookie: alpha.cookie },
    body: JSON.stringify({ currentAuthSecret: "alpha-client-derived-secret-000001", confirmationUsername: "alpha" })
  });
  const deleteCharlie = await fetch(`${baseUrl}/api/admin/users/${charlieUser.id}`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json", Cookie: alpha.cookie },
    body: JSON.stringify({ currentAuthSecret: "alpha-client-derived-secret-000001", confirmationUsername: "charlie" })
  });
  const purgeId = crypto.randomUUID();
  const tombstoneResponse = await fetch(`${baseUrl}/api/objects/${purgeId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", Cookie: alpha.cookie },
    body: JSON.stringify({ objectType: "note", ciphertext: "T".repeat(32), nonce: "z".repeat(24), encryptionVersion: 1, baseRevision: 0, idempotencyKey: crypto.randomUUID(), deleted: true })
  });
  const purgeHistoryId = crypto.randomUUID();
  const purgeHistoryResponse = await fetch(`${baseUrl}/api/notes/${purgeId}/history/${purgeHistoryId}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: alpha.cookie },
    body: JSON.stringify({
      ...historyEnvelope,
      capturedAt: new Date().toISOString(),
      idempotencyKey: crypto.randomUUID()
    })
  });
  const purgeResponse = await fetch(`${baseUrl}/api/objects/purge`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: alpha.cookie },
    body: JSON.stringify({ objects: [{ objectId: purgeId, baseRevision: 1 }] })
  });
  const afterPurge = await pull(alpha);
  const retentionUpdate = await fetch(`${baseUrl}/api/account/trash-retention`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Cookie: alpha.cookie },
    body: JSON.stringify({ days: null })
  });
  const retentionResponse = await fetch(`${baseUrl}/api/account/trash-retention`, { headers: { Cookie: alpha.cookie } });
  const retention = await retentionResponse.json();
  const passwordChange = await fetch(`${baseUrl}/api/auth/password`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: alpha.cookie },
    body: JSON.stringify({
      currentAuthSecret: "alpha-client-derived-secret-000001",
      newAuthSecret: "alpha-client-derived-secret-000099",
      newKdfSalt: "t".repeat(24),
      newKdfParams: { algorithm: "argon2id", opsLimit: 3, memLimit: 67108864, version: 1 },
      newWrappedVaultKey: "x".repeat(32),
      newWrappedVaultNonce: "y".repeat(24)
    })
  });
  const result = {
    health: true,
    alphaRole: alpha.body.user.role,
    bravoRole: bravo.body.user.role,
    sameOpaqueObjectId: syncA.changes[0]?.objectId === syncB.changes[0]?.objectId,
    isolated: syncA.changes.length === 1
      && syncB.changes.length === 1
      && syncA.changes[0].ciphertext !== syncB.changes[0].ciphertext,
    attachmentIsolated: chunkA === "alpha-encrypted-chunk" && chunkB === "bravo-encrypted-chunk",
    passwordChanged: passwordChange.ok,
    activationWorked: setupResponse.ok && activationResponse.ok,
    encryptedAvatarIsolated: avatarUpdate.ok && alphaAvatarResponse.ok && bravoAvatarResponse.ok && alphaAvatar.avatar?.ciphertext === avatarEnvelope.ciphertext && bravoAvatar.avatar === null,
    recoveryKeyResetProtected: recoveryKeyReset.ok && wrongRecoveryKeyReset.status === 401,
    userDeletionProtected: wrongDeletePassword.status === 401 && selfDelete.status === 400 && deleteCharlie.ok,
    purgePropagated: tombstoneResponse.ok && purgeResponse.ok && afterPurge.changes.some((change) => change.objectId === purgeId && change.purged),
    trashRetentionUpdated: retentionUpdate.ok && retentionResponse.ok && retention.days === null,
    noteHistoryWorked: historyWrite.ok
      && historyListResponse.ok
      && historyList.items.length === 1
      && historyRead.ok
      && crossUserHistoryList.ok
      && bravoHistoryList.items.length === 0
      && crossUserHistoryRead.status === 404,
    noteHistoryClearBarrierWorked: historyClear.ok && clearedHistoryReplay.status === 409,
    noteHistorySettingsWorked: historySettingsUpdate.ok
      && historySettings.intervalMinutes === 30
      && historySettings.retentionDays === 180
      && historySettings.quotaBytes === 256 * 1024 * 1024,
    endpointIdentityStable: initialEndpointsResponse.ok && initialEndpoints.endpoints.length === 2 && firstEndpointId === alpha.body.endpoint.id && currentEndpoint.loginCount === 2,
    endpointHistoryTracked: otherEndpoint.deviceName === "Chrome · iPhone" && currentEndpoint.remembered,
    rememberedCookiePersistent: alpha.setCookies.some((value) => value.startsWith("webmd_session=") && /Expires=/i.test(value)),
    earlySessionRevokeRejected: earlyRevokeResponse.status === 403,
    endpointRevocationIsolated: crossUserRevokeResponse.status === 404,
    matureSessionRevokeWorked: revokeResponse.ok && revokedDeviceResponse.status === 401,
    batchSyncWorked: batchResponse.ok
      && batchResult.results.every((entry) => entry.status === "accepted")
      && idempotentBatchResponse.ok
      && idempotentBatch.results.every((entry) => entry.status === "idempotent")
      && conflictBatchResponse.ok
      && conflictBatch.results[0]?.status === "conflict",
    sseReceiverNotified: receiverEvent?.cursor > syncA.cursor,
    sseSourceSuppressed: sourceEvent === null,
    sseCrossUserIsolated: crossUserEvent === null,
    compactPullWorked: compactResponse.ok
      && compactSync.changes.filter((change) => change.objectId === firstBatchObjectId).length === 1
      && compactSync.changes.find((change) => change.objectId === firstBatchObjectId)?.revision === 3
  };
  const verificationDb = new Database(join(dataDirectory, "notes.sqlite"), { readonly: true });
  const deletedUserRows = verificationDb.prepare("SELECT COUNT(*) AS count FROM users WHERE id = ?").get(charlieUser.id).count;
  const deletedObjectRows = verificationDb.prepare("SELECT COUNT(*) AS count FROM objects WHERE user_id = ?").get(charlieUser.id).count;
  const bravoRows = verificationDb.prepare("SELECT COUNT(*) AS count FROM users WHERE id = ?").get(bravo.body.user.id).count;
  const purgedHistoryRows = verificationDb.prepare("SELECT COUNT(*) AS count FROM note_history WHERE user_id = ? AND note_id = ?").get(alpha.body.user.id, purgeId).count;
  verificationDb.close();
  result.userDeletionCascaded = deletedUserRows === 0 && deletedObjectRows === 0 && bravoRows === 1;
  result.noteHistoryPurgedWithNote = purgeHistoryResponse.ok && purgedHistoryRows === 0;
  if (!result.isolated || !result.attachmentIsolated || !result.passwordChanged || !result.activationWorked || !result.encryptedAvatarIsolated || !result.recoveryKeyResetProtected || !result.userDeletionProtected || !result.userDeletionCascaded || !result.purgePropagated || !result.trashRetentionUpdated || !result.noteHistoryWorked || !result.noteHistoryClearBarrierWorked || !result.noteHistorySettingsWorked || !result.noteHistoryPurgedWithNote || !result.endpointIdentityStable || !result.endpointHistoryTracked || !result.rememberedCookiePersistent || !result.earlySessionRevokeRejected || !result.endpointRevocationIsolated || !result.matureSessionRevokeWorked || !result.batchSyncWorked || !result.sseReceiverNotified || !result.sseSourceSuppressed || !result.sseCrossUserIsolated || !result.compactPullWorked || result.alphaRole !== "admin" || result.bravoRole !== "user") {
    throw new Error(`Smoke assertions failed: ${JSON.stringify(result)}`);
  }
  console.log(JSON.stringify(result, null, 2));
} finally {
  if (server.exitCode === null && server.signalCode === null) {
    await new Promise((resolve) => {
      server.once("exit", resolve);
      server.kill("SIGTERM");
    });
  }
  await rm(dataDirectory, { recursive: true, force: true });
}
