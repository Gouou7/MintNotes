export interface SyncIntent {
  pull: boolean;
  push: boolean;
}

export interface SyncSchedule {
  delayMs: number;
  maxWaitMs: number;
}

interface SyncCoordinatorOptions {
  execute: (intent: SyncIntent) => Promise<void>;
  canRun?: () => boolean;
  setTimer?: typeof window.setTimeout;
  clearTimer?: typeof window.clearTimeout;
}

export class SyncCoordinator {
  private pendingPull = false;
  private pendingPush = false;
  private trailingTimer: number | null = null;
  private deadlineTimer: number | null = null;
  private deadlineAt: number | null = null;
  private running = false;
  private disposed = false;
  private readonly execute: SyncCoordinatorOptions["execute"];
  private readonly canRun: () => boolean;
  private readonly setTimer: typeof window.setTimeout;
  private readonly clearTimer: typeof window.clearTimeout;

  constructor(options: SyncCoordinatorOptions) {
    this.execute = options.execute;
    this.canRun = options.canRun ?? (() => true);
    this.setTimer = options.setTimer ?? window.setTimeout.bind(window);
    this.clearTimer = options.clearTimer ?? window.clearTimeout.bind(window);
  }

  request(intent: Partial<SyncIntent>, schedule: SyncSchedule): void {
    if (this.disposed) return;
    this.pendingPull ||= intent.pull === true;
    this.pendingPush ||= intent.push === true;
    if (!this.pendingPull && !this.pendingPush) return;
    if (this.running || !this.canRun()) return;

    if (this.trailingTimer !== null) this.clearTimer(this.trailingTimer);
    this.trailingTimer = this.setTimer(() => {
      this.trailingTimer = null;
      void this.drain();
    }, Math.max(0, schedule.delayMs));

    const candidateDeadline = Date.now() + Math.max(schedule.delayMs, schedule.maxWaitMs);
    if (this.deadlineAt === null || candidateDeadline < this.deadlineAt) {
      if (this.deadlineTimer !== null) this.clearTimer(this.deadlineTimer);
      this.deadlineAt = candidateDeadline;
      this.deadlineTimer = this.setTimer(() => {
        this.deadlineTimer = null;
        this.deadlineAt = null;
        void this.drain();
      }, Math.max(0, candidateDeadline - Date.now()));
    }
  }

  runNow(intent: Partial<SyncIntent> = {}): Promise<void> {
    if (this.disposed) return Promise.resolve();
    this.pendingPull ||= intent.pull === true;
    this.pendingPush ||= intent.push === true;
    this.cancelTimers();
    return this.drain();
  }

  resume(): Promise<void> {
    if (!this.pendingPull && !this.pendingPush) return Promise.resolve();
    return this.runNow();
  }

  dispose(): void {
    this.disposed = true;
    this.cancelTimers();
    this.pendingPull = false;
    this.pendingPush = false;
  }

  private cancelTimers(): void {
    if (this.trailingTimer !== null) this.clearTimer(this.trailingTimer);
    if (this.deadlineTimer !== null) this.clearTimer(this.deadlineTimer);
    this.trailingTimer = null;
    this.deadlineTimer = null;
    this.deadlineAt = null;
  }

  private async drain(): Promise<void> {
    if (this.disposed || this.running || !this.canRun()) return;
    this.cancelTimers();
    this.running = true;
    try {
      while (!this.disposed && this.canRun() && (this.pendingPull || this.pendingPush)) {
        const intent = { pull: this.pendingPull, push: this.pendingPush };
        this.pendingPull = false;
        this.pendingPush = false;
        await this.execute(intent);
      }
    } finally {
      this.running = false;
    }
  }
}

export function mergeByObjectId<T extends { objectId: string }>(
  current: readonly T[],
  upserts: Iterable<T>,
  removals: Iterable<string> = []
): T[] {
  const merged = new Map(current.map((entry) => [entry.objectId, entry]));
  for (const objectId of removals) merged.delete(objectId);
  for (const entry of upserts) merged.set(entry.objectId, entry);
  return [...merged.values()];
}

export function acknowledgeByObjectId<T extends { objectId: string; serverRevision: number; dirty: boolean }>(
  current: readonly T[],
  revisions: ReadonlyMap<string, number>
): T[] {
  if (!revisions.size) return current as T[];
  return current.map((entry) => {
    const revision = revisions.get(entry.objectId);
    return revision === undefined ? entry : { ...entry, serverRevision: revision, dirty: false };
  });
}

export function packBySerializedSize<T>(
  entries: readonly T[],
  serialize: (entries: readonly T[]) => string,
  maxItems = 50,
  maxBytes = 1_572_864
): { batches: T[][]; oversized: T[] } {
  const encoder = new TextEncoder();
  const batches: T[][] = [];
  const oversized: T[] = [];
  let batch: T[] = [];

  for (const entry of entries) {
    const candidate = [...batch, entry];
    if (candidate.length <= maxItems && encoder.encode(serialize(candidate)).byteLength <= maxBytes) {
      batch = candidate;
      continue;
    }
    if (batch.length) batches.push(batch);
    batch = [];
    if (encoder.encode(serialize([entry])).byteLength > maxBytes) oversized.push(entry);
    else batch = [entry];
  }
  if (batch.length) batches.push(batch);
  return { batches, oversized };
}
