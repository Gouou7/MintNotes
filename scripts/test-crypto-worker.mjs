import { readdirSync } from "node:fs";
import { resolve } from "node:path";
import { Worker } from "node:worker_threads";
import { pathToFileURL } from "node:url";

const asset = readdirSync("./dist/assets").find(
  (name) => name.startsWith("crypto.worker-") && name.endsWith(".js")
);
if (!asset) throw new Error("Build the web application before running the crypto-worker test");

const workerUrl = pathToFileURL(resolve("./dist/assets", asset)).href;
const harness = `
import { parentPort, workerData } from "node:worker_threads";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
globalThis.self = globalThis;
globalThis.__dirname = dirname(fileURLToPath(workerData));
globalThis.postMessage = (message) => parentPort.postMessage(message);
parentPort.on("message", (data) => globalThis.onmessage({ data }));
await import(workerData);
parentPort.postMessage({ ready: true });
`;
const harnessUrl = new URL(`data:text/javascript,${encodeURIComponent(harness)}`);

function createCryptoWorker() {
  const worker = new Worker(harnessUrl, { type: "module", workerData: workerUrl });
  let nextId = 0;
  let markReady;
  const ready = new Promise((resolveReady) => { markReady = resolveReady; });
  worker.on("message", (message) => {
    if (message.ready) markReady();
  });
  const call = async (operation, payload) => {
    await ready;
    const id = ++nextId;
    return new Promise((resolveCall, reject) => {
      const listener = (message) => {
        if (message.id !== id) return;
        worker.off("message", listener);
        if (message.error) reject(new Error(message.error));
        else resolveCall(message.result);
      };
      worker.on("message", listener);
      worker.postMessage({ id, operation, payload });
    });
  };
  return { worker, call };
}

const username = "crypto_worker_test";
const password = "Mint Notes crypto integration test password";
const userId = "11111111-1111-4111-8111-111111111111";
const objectId = "22222222-2222-4222-8222-222222222222";
const document = {
  kind: "note",
  title: "Cross-worker test",
  markdown: "# Encrypted across reloads",
  parentId: null,
  tags: [],
  favorite: false,
  deleted: false,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  manualOrder: 1024,
  attachmentIds: [],
  schemaVersion: 2
};

const registrationWorker = createCryptoWorker();
const registration = await registrationWorker.call("createRegistration", { username, password });
await registrationWorker.worker.terminate();

const loginWorker = createCryptoWorker();
const login = await loginWorker.call("prepareLogin", {
  password,
  kdfSalt: registration.kdfSalt,
  kdfParams: registration.kdfParams
});
if (login.authSecret !== registration.authSecret) {
  throw new Error("Authentication derivation changed across fresh workers");
}
await loginWorker.call("unlockVault", {
  username,
  wrappedVaultKey: registration.wrappedVaultKey,
  wrappedVaultNonce: registration.wrappedVaultNonce
});
const encrypted = await loginWorker.call("encryptObject", {
  userId,
  objectId,
  objectType: "note",
  revision: 1,
  document
});
const deviceKey = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
const deviceWrapped = await loginWorker.call("wrapVaultForDevice", { userId, deviceKey });
await loginWorker.worker.terminate();

const deviceWorker = createCryptoWorker();
const pinSalt = "MTIzNDU2Nzg5MGFiY2RlZg";
const pinVerifier = await deviceWorker.call("derivePinVerifier", { pin: "246810", salt: pinSalt });
const repeatedPinVerifier = await deviceWorker.call("derivePinVerifier", { pin: "246810", salt: pinSalt });
const otherPinVerifier = await deviceWorker.call("derivePinVerifier", { pin: "135790", salt: pinSalt });
if (pinVerifier.verifier !== repeatedPinVerifier.verifier || pinVerifier.verifier === otherPinVerifier.verifier) {
  throw new Error("Local PIN verifier is not stable or domain separated");
}
await deviceWorker.call("unlockVaultFromDevice", {
  userId,
  deviceKey,
  ciphertext: deviceWrapped.ciphertext,
  nonce: deviceWrapped.nonce
});
const deviceDecrypted = await deviceWorker.call("decryptObject", {
  userId,
  objectId,
  objectType: "note",
  revision: 1,
  ciphertext: encrypted.ciphertext,
  nonce: encrypted.nonce
});
await deviceWorker.worker.terminate();

const tamperedDeviceWorker = createCryptoWorker();
const lastDeviceCharacter = deviceWrapped.ciphertext.at(-1);
const tamperedDeviceCiphertext = `${deviceWrapped.ciphertext.slice(0, -1)}${lastDeviceCharacter === "A" ? "B" : "A"}`;
let tamperedDeviceCredentialRejected = false;
try {
  await tamperedDeviceWorker.call("unlockVaultFromDevice", {
    userId,
    deviceKey,
    ciphertext: tamperedDeviceCiphertext,
    nonce: deviceWrapped.nonce
  });
} catch {
  tamperedDeviceCredentialRejected = true;
}
await tamperedDeviceWorker.worker.terminate();
if (!tamperedDeviceCredentialRejected) throw new Error("Tampered device credential was accepted");

const recoveryWorker = createCryptoWorker();
const recovery = await recoveryWorker.call("unlockRecovery", {
  username,
  recoveryCode: registration.recoveryCode,
  wrappedVaultKey: registration.recoveryWrappedVaultKey,
  wrappedVaultNonce: registration.recoveryWrappedVaultNonce
});
if (recovery.recoveryAuthSecret !== registration.recoveryAuthSecret) {
  throw new Error("Recovery derivation changed across fresh workers");
}
const decrypted = await recoveryWorker.call("decryptObject", {
  userId,
  objectId,
  objectType: "note",
  revision: 1,
  ciphertext: encrypted.ciphertext,
  nonce: encrypted.nonce
});
const attachmentBytes = new TextEncoder().encode("encrypted attachment round trip");
const attachment = await recoveryWorker.call("createAttachment", {
  userId,
  attachmentId: "33333333-3333-4333-8333-333333333333",
  ownerNoteId: objectId,
  originalName: "test.png",
  mime: "image/png",
  data: attachmentBytes.buffer,
  chunkSize: 8
});
const decryptedAttachment = await recoveryWorker.call("decryptAttachment", {
  userId,
  attachmentId: "33333333-3333-4333-8333-333333333333",
  metadata: attachment.metadata,
  chunks: attachment.chunks
});
if (new Set(attachment.chunks.map((chunk) => chunk.nonce)).size !== attachment.chunks.length) {
  throw new Error("Attachment chunk nonce was reused");
}
const tamperedChunks = structuredClone(attachment.chunks);
new Uint8Array(tamperedChunks[0].ciphertext)[0] ^= 1;
let tamperRejected = false;
try {
  await recoveryWorker.call("decryptAttachment", {
    userId,
    attachmentId: "33333333-3333-4333-8333-333333333333",
    metadata: attachment.metadata,
    chunks: tamperedChunks
  });
} catch {
  tamperRejected = true;
}
if (!tamperRejected) throw new Error("Tampered attachment chunk was accepted");
const avatarBytes = new TextEncoder().encode("processed avatar bytes");
const encryptedAvatar = await recoveryWorker.call("encryptProfileAvatar", { userId, mime: "image/webp", data: avatarBytes.buffer });
const decryptedAvatar = await recoveryWorker.call("decryptProfileAvatar", { userId, ...encryptedAvatar });
if (decryptedAvatar.mime !== "image/webp" || new TextDecoder().decode(decryptedAvatar.data) !== "processed avatar bytes") {
  throw new Error("Encrypted profile avatar did not round-trip");
}
let tamperedAvatarRejected = false;
try {
  await recoveryWorker.call("decryptProfileAvatar", { userId: `${userId}-other`, ...encryptedAvatar });
} catch {
  tamperedAvatarRejected = true;
}
if (!tamperedAvatarRejected) throw new Error("Profile avatar accepted the wrong user binding");
const historyId = "44444444-4444-4444-8444-444444444444";
const capturedAt = "2026-07-24T12:00:00.000Z";
const historyPayload = {
  schemaVersion: 1,
  capturedAt,
  title: document.title,
  markdown: document.markdown,
  tags: document.tags,
  attachmentIds: document.attachmentIds,
  sourceUpdatedAt: document.updatedAt
};
const encryptedHistory = await recoveryWorker.call("encryptHistory", {
  userId,
  noteId: objectId,
  historyId,
  capturedAt,
  captureKind: "manual",
  document: historyPayload
});
const decryptedHistory = await recoveryWorker.call("decryptHistory", {
  userId,
  noteId: objectId,
  historyId,
  capturedAt,
  captureKind: "manual",
  ciphertext: encryptedHistory.ciphertext,
  nonce: encryptedHistory.nonce
});
for (const tampered of [
  { userId: "99999999-9999-4999-8999-999999999999" },
  { noteId: "88888888-8888-4888-8888-888888888888" },
  { historyId: "77777777-7777-4777-8777-777777777777" },
  { capturedAt: "2026-07-24T12:01:00.000Z" },
  { captureKind: "idle" }
]) {
  let rejected = false;
  try {
    await recoveryWorker.call("decryptHistory", {
      userId,
      noteId: objectId,
      historyId,
      capturedAt,
      captureKind: "manual",
      ciphertext: encryptedHistory.ciphertext,
      nonce: encryptedHistory.nonce,
      ...tampered
    });
  } catch {
    rejected = true;
  }
  if (!rejected) throw new Error(`History AAD accepted tampered ${Object.keys(tampered)[0]}`);
}
const rotatedRecovery = await recoveryWorker.call("rotateRecoveryKey", { username });
await recoveryWorker.worker.terminate();

const rotatedRecoveryWorker = createCryptoWorker();
const rotatedUnlock = await rotatedRecoveryWorker.call("unlockRecovery", {
  username,
  recoveryCode: rotatedRecovery.recoveryCode,
  wrappedVaultKey: rotatedRecovery.recoveryWrappedVaultKey,
  wrappedVaultNonce: rotatedRecovery.recoveryWrappedVaultNonce
});
if (rotatedUnlock.recoveryAuthSecret !== rotatedRecovery.recoveryAuthSecret) throw new Error("Rotated recovery key is invalid");
await rotatedRecoveryWorker.worker.terminate();

const oldRecoveryWorker = createCryptoWorker();
let oldRecoveryRejected = false;
try {
  await oldRecoveryWorker.call("unlockRecovery", {
    username,
    recoveryCode: registration.recoveryCode,
    wrappedVaultKey: rotatedRecovery.recoveryWrappedVaultKey,
    wrappedVaultNonce: rotatedRecovery.recoveryWrappedVaultNonce
  });
} catch {
  oldRecoveryRejected = true;
}
await oldRecoveryWorker.worker.terminate();
if (!oldRecoveryRejected) throw new Error("Old recovery key opened the rotated recovery envelope");

if (JSON.stringify(decrypted) !== JSON.stringify(document)) {
  throw new Error("Cross-worker encrypted document did not round-trip");
}
if (JSON.stringify(deviceDecrypted) !== JSON.stringify(document)) {
  throw new Error("Device-unlocked document did not round-trip across workers");
}
if (new TextDecoder().decode(decryptedAttachment) !== "encrypted attachment round trip") {
  throw new Error("Encrypted attachment did not round-trip");
}
if (JSON.stringify(decryptedHistory) !== JSON.stringify(historyPayload)) {
  throw new Error("Encrypted note history did not round-trip");
}

console.log(JSON.stringify({
  authenticationAcrossWorkers: true,
  recoveryAcrossWorkers: true,
  deviceUnlockAcrossWorkers: true,
  localPinVerifier: true,
  tamperedDeviceCredentialRejected: true,
  encryptedDocumentRoundTrip: true,
  encryptedAttachmentRoundTrip: true,
  uniqueAttachmentNonces: true,
  tamperedAttachmentRejected: true,
  encryptedProfileAvatarRoundTrip: true,
  tamperedProfileAvatarRejected: true,
  encryptedHistoryRoundTrip: true,
  tamperedHistoryBindingRejected: true,
  rotatedRecoveryKeyWorks: true,
  oldRecoveryKeyRejected: true
}, null, 2));
