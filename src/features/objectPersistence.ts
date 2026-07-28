import type { OpenAttachment, OpenDocument } from "../types";

type PersistableObject = OpenDocument | OpenAttachment;

type PreparePersistenceOptions = {
  preserveUpdatedAt?: boolean;
  now?: string;
};

export interface CoordinatedWriteResult<T> {
  value: T;
  isLatest: boolean;
}

type WriteLane = {
  tail: Promise<void>;
  latestToken: number;
};

/**
 * Serializes durable writes for the same object while allowing unrelated
 * objects to proceed independently.
 */
export class ObjectWriteCoordinator {
  private readonly lanes = new Map<string, WriteLane>();
  private nextToken = 0;
  private accepting = true;
  private closed = false;

  enqueue<T>(key: string, write: () => Promise<T>): Promise<CoordinatedWriteResult<T>> {
    if (!this.accepting || this.closed) {
      return Promise.reject(new DOMException("Object persistence is paused", "AbortError"));
    }

    const previous = this.lanes.get(key);
    const token = ++this.nextToken;
    const lane: WriteLane = previous ?? { tail: Promise.resolve(), latestToken: token };
    lane.latestToken = token;

    const result = lane.tail.then(write).then((value) => ({
      value,
      isLatest: lane.latestToken === token
    }));
    const tail = result.then(() => undefined, () => undefined);
    lane.tail = tail;
    this.lanes.set(key, lane);
    void tail.then(() => {
      if (this.lanes.get(key) === lane && lane.tail === tail) this.lanes.delete(key);
    });
    return result;
  }

  async drain(key: string): Promise<void> {
    while (true) {
      const lane = this.lanes.get(key);
      if (!lane) return;
      const tail = lane.tail;
      await tail;
      const current = this.lanes.get(key);
      if (!current || current.tail === tail) return;
    }
  }

  async drainAll(): Promise<void> {
    while (this.lanes.size) {
      const tails = [...this.lanes.values()].map((lane) => lane.tail);
      await Promise.all(tails);
      if ([...this.lanes.values()].every((lane) => tails.includes(lane.tail))) return;
    }
  }

  pause(): void {
    this.accepting = false;
  }

  resume(): void {
    if (!this.closed) this.accepting = true;
  }

  async close(): Promise<void> {
    this.accepting = false;
    this.closed = true;
    await this.drainAll();
  }
}

export function prepareObjectForPersistence<T extends PersistableObject>(
  object: T,
  baseRevision: number,
  options: PreparePersistenceOptions = {}
): T {
  return {
    ...object,
    updatedAt: options.preserveUpdatedAt ? object.updatedAt : options.now ?? new Date().toISOString(),
    serverRevision: baseRevision,
    dirty: true
  };
}
