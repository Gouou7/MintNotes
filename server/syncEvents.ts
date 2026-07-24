import type { ServerResponse } from "node:http";

interface SyncSubscriber {
  userId: string;
  sessionId: string;
  endpointId: string;
  clientId: string;
  response: ServerResponse;
}

interface PendingNotification {
  cursor: number;
  targets: Set<SyncSubscriber>;
}

export class SyncEventHub {
  private readonly subscribers = new Set<SyncSubscriber>();
  private readonly pending = new Map<string, PendingNotification>();
  private flushTimer: NodeJS.Timeout | null = null;

  subscribe(subscriber: SyncSubscriber): () => void {
    this.subscribers.add(subscriber);
    return () => this.subscribers.delete(subscriber);
  }

  publish(userId: string, cursor: number, sourceClientId?: string): void {
    const targets = [...this.subscribers].filter((subscriber) => (
      subscriber.userId === userId && (!sourceClientId || subscriber.clientId !== sourceClientId)
    ));
    if (!targets.length) return;
    const current = this.pending.get(userId);
    if (current) {
      current.cursor = Math.max(current.cursor, cursor);
      for (const subscriber of targets) current.targets.add(subscriber);
    } else {
      this.pending.set(userId, {
        cursor,
        targets: new Set(targets)
      });
    }
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => this.flush(), 50);
    this.flushTimer.unref();
  }

  closeSession(sessionId: string): void {
    this.closeWhere((subscriber) => subscriber.sessionId === sessionId);
  }

  closeEndpoint(userId: string, endpointId: string): void {
    this.closeWhere((subscriber) => subscriber.userId === userId && subscriber.endpointId === endpointId);
  }

  closeUser(userId: string, exceptSessionId?: string): void {
    this.closeWhere((subscriber) => subscriber.userId === userId && subscriber.sessionId !== exceptSessionId);
  }

  closeAll(): void {
    this.closeWhere(() => true);
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.flushTimer = null;
    this.pending.clear();
  }

  private flush(): void {
    this.flushTimer = null;
    for (const [userId, notification] of this.pending) {
      const payload = `event: changed\ndata: ${JSON.stringify({ cursor: notification.cursor })}\n\n`;
      for (const subscriber of notification.targets) {
        if (!this.subscribers.has(subscriber)) continue;
        if (subscriber.userId !== userId) continue;
        if (!subscriber.response.destroyed && !subscriber.response.writableEnded) {
          subscriber.response.write(payload);
        }
      }
    }
    this.pending.clear();
  }

  private closeWhere(predicate: (subscriber: SyncSubscriber) => boolean): void {
    for (const subscriber of [...this.subscribers]) {
      if (!predicate(subscriber)) continue;
      this.subscribers.delete(subscriber);
      if (!subscriber.response.destroyed && !subscriber.response.writableEnded) subscriber.response.end();
    }
  }
}
