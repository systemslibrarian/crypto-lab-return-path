/**
 * Dispatch an experiment to the Worker, or run it here if there is no Worker.
 *
 * The fallback is not defensive padding. A Worker is one more thing that can
 * fail to load under a project subpath, and a page whose results never arrive
 * renders an empty region -- which an accessibility scan reports as perfectly
 * accessible and a reader sees as a broken page. Falling back to the main thread
 * keeps the page honest at the cost of a stutter, and `usingWorker` says which
 * path is live so the page can report it.
 */
import { runJob, type JobRequest, type JobResult } from '../crypto/jobs.ts';
import type { WorkerOut } from '../worker/experiments.worker.ts';

type Pending = {
  resolve: (r: JobResult) => void;
  reject: (e: Error) => void;
};

let worker: Worker | null = null;
let workerBroken = false;
let nextId = 1;
const pending = new Map<number, Pending>();

function ensureWorker(): Worker | null {
  if (workerBroken) return null;
  if (worker) return worker;
  try {
    worker = new Worker(new URL('../worker/experiments.worker.ts', import.meta.url), {
      type: 'module',
    });
    worker.addEventListener('message', (event: MessageEvent<WorkerOut>) => {
      const entry = pending.get(event.data.id);
      if (!entry) return;
      pending.delete(event.data.id);
      if (event.data.ok) entry.resolve(event.data.result);
      else entry.reject(new Error(event.data.error));
    });
    worker.addEventListener('error', () => {
      workerBroken = true;
      for (const [id, entry] of pending) {
        pending.delete(id);
        entry.reject(new Error('worker failed'));
      }
    });
    return worker;
  } catch {
    workerBroken = true;
    return null;
  }
}

export function usingWorker(): boolean {
  return !workerBroken && worker !== null;
}

/** Yield to the event loop so a spinner can paint before a synchronous run blocks it. */
function nextFrame(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => resolve());
    else setTimeout(resolve, 0);
  });
}

export async function compute(req: JobRequest): Promise<JobResult> {
  const w = ensureWorker();
  if (!w) {
    await nextFrame();
    return runJob(req);
  }
  const id = nextId++;
  try {
    return await new Promise<JobResult>((resolve, reject) => {
      pending.set(id, { resolve, reject });
      w.postMessage({ id, req });
    });
  } catch {
    // The Worker died mid-flight. Finish the job rather than leaving the region
    // empty: an empty region is the failure mode a scan cannot see.
    workerBroken = true;
    await nextFrame();
    return runJob(req);
  }
}
