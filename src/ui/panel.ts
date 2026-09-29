/**
 * The run harness every measuring panel shares: latest-request-wins, busy state,
 * one concise announcement, and the elapsed-time readout.
 *
 * It exists so all five panels behave identically rather than nearly identically,
 * and so three things that are easy to get subtly wrong are got right in one
 * place:
 *
 *  1. STALE RESPONSES ARE DROPPED. See `latest.ts`. A Worker answering an older
 *     request after a newer one would otherwise paint the previous S-box's
 *     numbers under the new S-box's label.
 *
 *  2. THE LIVE REGION IS SMALL. The result container is a labelled `region` with
 *     `aria-busy`, NOT a `status`. A `status` wrapped around charts, tables,
 *     verdicts and disclosures makes a screen reader re-read the entire panel on
 *     every rerun -- which passes every automated check and is miserable to use.
 *     The announcement is one sentence in its own tiny live region: what
 *     finished, and the number that matters.
 *
 *  3. FOCUS IS NEVER MOVED. The reader pressed a button; focus stays on it, and
 *     the result sits next in reading order. Stealing focus to the result is the
 *     usual well-meant mistake.
 */
import { Latest, setBusy, type Ticket } from './latest.ts';
import { el, markRun } from './dom.ts';
import { usingWorker } from './compute.ts';

export interface RunMeta {
  /** Wall-clock milliseconds for the job, rounded. */
  readonly elapsedMs: number;
  /** Whether a Worker ran it, or the main-thread fallback did. */
  readonly worker: boolean;
}

export class PanelRunner<I extends Record<string, unknown>> {
  readonly out: HTMLElement;
  readonly announce: HTMLElement;
  readonly meta: HTMLElement;
  #latest = new Latest<I>();
  #buttons: HTMLButtonElement[] = [];

  constructor(id: string, label: string) {
    // A labelled region, not a status: see rule 2 above.
    this.out = el('div', { id, role: 'region', 'aria-label': label, 'data-run': '0' });
    this.announce = el('p', {
      class: 'announce',
      id: `${id}-announce`,
      role: 'status',
      'aria-live': 'polite',
    });
    this.meta = el('p', { class: 'run-meta', id: `${id}-meta` });
  }

  /**
   * Buttons to mark unavailable for the duration of a run.
   *
   * `aria-disabled`, NOT the `disabled` property. A truly disabled control is
   * removed from the tab order, and disabling the one the reader just pressed
   * throws focus to `<body>` -- losing a keyboard user's place mid-interaction.
   * The claims suite caught exactly that. The click handlers consult `busy`
   * instead, so a press during a run is ignored rather than acted on twice.
   */
  manage(...buttons: HTMLButtonElement[]): void {
    this.#buttons = buttons;
  }

  /** True while a run is outstanding: a guard for the click handlers. */
  get busy(): boolean {
    return this.#latest.busy;
  }

  #setAvailability(available: boolean): void {
    for (const b of this.#buttons) {
      if (available) b.removeAttribute('aria-disabled');
      else b.setAttribute('aria-disabled', 'true');
    }
  }

  /** The inputs behind whatever is currently rendered, for a staleness check. */
  get currentId(): number {
    return this.#latest.currentId;
  }

  /**
   * Run a job and render its result, unless a newer run has started meanwhile.
   *
   * `render` returns the single sentence to announce. Returning an empty string
   * announces nothing, which is right for a run that only restated what was
   * already on screen.
   */
  async run<R>(
    inputs: I,
    placeholder: string,
    job: (ticket: Ticket<I>) => Promise<R>,
    render: (result: R, meta: RunMeta) => string
  ): Promise<void> {
    const ticket = this.#latest.begin(inputs);
    setBusy(this.out, true);
    this.#setAvailability(false);
    this.announce.textContent = '';
    this.out.replaceChildren(el('p', { class: 'field-hint', text: placeholder }));
    this.meta.textContent = '';

    const started = performance.now();
    let result: R;
    try {
      result = await job(ticket);
    } catch (err) {
      // A failed job must still settle, or the panel stays busy forever.
      if (this.#latest.settle(ticket)) {
        this.out.replaceChildren(
          el('p', { class: 'field-hint', text: `The run did not complete: ${String(err)}` })
        );
        this.announce.textContent = 'The run did not complete.';
        setBusy(this.out, false);
        markRun(this.out);
      }
      this.#setAvailability(true);
      return;
    }
    const elapsedMs = Math.round(performance.now() - started);

    // A stale answer renders nothing and clears nothing -- not even the busy
    // flag, which would tell a reader the panel had settled while the newest
    // request is still in flight.
    if (!this.#latest.settle(ticket)) {
      return;
    }

    const worker = usingWorker();
    this.out.replaceChildren();
    const sentence = render({ ...(result as object) } as R, { elapsedMs, worker });
    this.meta.textContent = `${elapsedMs} ms, ${worker ? 'in a worker thread' : 'on the main thread (no worker available)'}.`;
    this.announce.textContent = sentence;
    setBusy(this.out, false);
    this.#setAvailability(true);
    markRun(this.out);
  }
}
