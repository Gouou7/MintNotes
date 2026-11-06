import * as transport from "../../api";
import * as encryption from "../../crypto/client";
import type { WorkspaceServices } from "./workspaceServices";

export function testCryptoClient() {
  return Reflect.get(encryption, "cryptoClient") as WorkspaceServices["cryptoClient"];
}

export function testWorkspaceServices(): WorkspaceServices {
  return {
    transport: {
      api: transport.api,
      ...("uploadAttachmentChunk" in transport ? { uploadAttachmentChunk: transport.uploadAttachmentChunk } : {}),
      ...("downloadAttachmentChunk" in transport ? { downloadAttachmentChunk: transport.downloadAttachmentChunk } : {}),
      ...("setSyncLease" in transport ? { setSyncLease: transport.setSyncLease } : {})
    },
    ...("cryptoClient" in encryption ? { cryptoClient: testCryptoClient() } : {})
  } as WorkspaceServices;
}
