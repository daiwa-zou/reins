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
export class RunBus extends EventEmitter {
  private seq: number;
  constructor(public readonly runId: string, persist = true) {
    super();
    this.persist = persist;
    const existing = persist ? readEvents(runId) : [];
    this.seq = existing.length ? existing[existing.length - 1].seq + 1 : 0;
  }
  private persist: boolean;

  emitEvent(payload: Payload): RunEvent {
    const ev = { ...payload, seq: this.seq++, ts: new Date().toISOString(), runId: this.runId } as RunEvent;
    if (this.persist) appendEvent(ev);
    this.emit("event", ev);
    return ev;
  }
}
