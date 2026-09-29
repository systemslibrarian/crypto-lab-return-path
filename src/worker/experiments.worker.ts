/**
 * The experiments run here so the main thread stays responsive. An exhaustive
 * Act 1 run is 8.4 million encryptions per round count; on the main thread that
 * is a frozen page, and a frozen page is one a keyboard reader cannot leave.
 *
 * No logic lives here. It calls `runJob`, the same function the main thread
 * falls back to when a Worker cannot be constructed, so there is nothing that
 * can be right in one path and wrong in the other.
 */
import { runJob, type JobRequest, type JobResult } from '../crypto/jobs.ts';

export interface WorkerIn {
  readonly id: number;
  readonly req: JobRequest;
}
export type WorkerOut =
  | { readonly id: number; readonly ok: true; readonly result: JobResult }
  | { readonly id: number; readonly ok: false; readonly error: string };

self.addEventListener('message', (event: MessageEvent<WorkerIn>) => {
  const { id, req } = event.data;
  try {
    const result = runJob(req);
    (self as unknown as Worker).postMessage({ id, ok: true, result } satisfies WorkerOut);
  } catch (err) {
    (self as unknown as Worker).postMessage({
      id,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    } satisfies WorkerOut);
  }
});
