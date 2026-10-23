import type { OpenAttachment } from "./types.js";
import { attachmentIdsIn, ATTACHMENT_URL_PATTERN } from "./attachmentFormat.js";

export interface AttachmentCloneDependencies {
  resolveAttachment: (attachmentId: string) => OpenAttachment | undefined;
  readAttachment: (attachment: OpenAttachment) => Promise<Blob>;
  createAttachment: (
    ownerNoteId: string,
    source: OpenAttachment,
    plaintext: Blob
  ) => Promise<OpenAttachment>;
  persistAttachment: (attachment: OpenAttachment) => Promise<OpenAttachment>;
  removeAttachment: (attachmentId: string) => Promise<void>;
}

export interface CloneAttachmentGraphInput {
  sourceMarkdown: string;
  sourceAttachmentIds: readonly string[];
  targetNoteId: string;
  allowMissing?: boolean;
}

export interface CloneAttachmentGraphResult {
  markdown: string;
  attachmentIds: string[];
  attachments: OpenAttachment[];
  missingAttachmentIds: string[];
}

/**
 * Copies the complete attachment graph for a note. All source plaintext is
 * recovered before any target is created so a missing source cannot produce
 * an intentionally incomplete copy.
 */
export class AttachmentCloneService {
  constructor(private readonly dependencies: AttachmentCloneDependencies) {}

  async clone(input: CloneAttachmentGraphInput): Promise<CloneAttachmentGraphResult> {
    const sourceIds = [...new Set([
      ...input.sourceAttachmentIds,
      ...attachmentIdsIn(input.sourceMarkdown)
    ])];
    const missingAttachmentIds: string[] = [];
    const sources: Array<{ attachment: OpenAttachment; plaintext: Blob }> = [];

    for (const attachmentId of sourceIds) {
      const attachment = this.dependencies.resolveAttachment(attachmentId);
      if (!attachment || (attachment.deleted && !input.allowMissing)) {
        if (input.allowMissing) { missingAttachmentIds.push(attachmentId); continue; }
        throw new Error(`Attachment ${attachmentId} is unavailable`);
      }
      try { sources.push({ attachment, plaintext: await this.dependencies.readAttachment(attachment) }); }
      catch (error) { if (!input.allowMissing) throw error; missingAttachmentIds.push(attachmentId); }
    }

    const created: OpenAttachment[] = [];
    let markdown = input.sourceMarkdown;
    try {
      for (const source of sources) {
        const attachment = await this.dependencies.createAttachment(
          input.targetNoteId,
          source.attachment,
          source.plaintext
        );
        created.push(attachment);
        await this.dependencies.persistAttachment(attachment);
        markdown = markdown.replace(ATTACHMENT_URL_PATTERN, (reference, sourceId: string) => (
          sourceId.toLowerCase() === source.attachment.objectId.toLowerCase()
            ? `webmd-attachment:${attachment.objectId}` : reference
        ));
      }
      return {
        markdown,
        attachmentIds: created.map((attachment) => attachment.objectId),
        attachments: created, missingAttachmentIds
      };
    } catch (error) {
      await Promise.allSettled(created.map((attachment) => (
        this.dependencies.removeAttachment(attachment.objectId)
      )));
      throw error;
    }
  }
}
