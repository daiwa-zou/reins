import { EventEmitter } from "node:events";
import type { RunEvent } from "../../../shared/types.js";
import { appendEvent, readEvents } from "../store/runStore.js";

type DistributiveOmit<T, K extends keyof any> = T extends any ? Omit<T, K> : never;
export type Payload = DistributiveOmit<RunEvent, "seq" | "ts" | "runId">;

/**
 * One bus per run: assigns sequence numbers, persists to the JSONL log and
 * fans out to WebSocket subscribers. Persist-before-publish so a reconnecting
 * client can always catch up from the log.
 */
/** Where a bus persists its log. Runs use $REINS_HOME/runs/<id>/events.jsonl; intake jobs bring their own. */
export interface EventStore {
  append(ev: RunEvent): void;
  read(): RunEvent[];
}

export class RunBus extends EventEmitter {
  private seq: number;
  private store: EventStore | null;
  constructor(public readonly runId: string, persist = true, store?: EventStore) {
    super();
    this.store = store ?? (persist ? { append: appendEvent, read: () => readEvents(runId) } : null);
    const existing = this.store ? this.store.read() : [];
    this.seq = existing.length ? existing[existing.length - 1].seq + 1 : 0;
  }

  emitEvent(payload: Payload): RunEvent {
    const ev = { ...payload, seq: this.seq++, ts: new Date().toISOString(), runId: this.runId } as RunEvent;
    if (this.store) this.store.append(ev);
    this.emit("event", ev);
    return ev;
  }
}
