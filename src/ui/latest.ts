/**
 * Latest-request-wins, with an immutable snapshot of the inputs each request was
 * made under.
 *
 * WHY THIS IS NOT POLISH. Changing the S-box starts five Worker jobs at once.
 * Workers do not promise to answer in the order they were asked, and a slower
 * earlier job can land after a faster later one -- so a fast toggle can paint the
 * PREVIOUS S-box's numbers underneath the new S-box's label. For a page whose
 * entire argument is "these numbers came from this cipher", showing one set of
 * inputs beside another set's evidence is the worst failure available, worse
 * than showing nothing, and it is invisible in a screenshot.
 *
 * So every panel routes its runs through one of these. `begin(inputs)` returns a
 * ticket carrying a monotonically increasing id and a frozen copy of the inputs;
 * `ticket.current` is true only while no later ticket has been issued. A response
 * whose ticket is stale is DROPPED -- not rendered, and not allowed to clear the
 * busy flag, because clearing it would tell a reader the panel had settled when
 * a newer request is still in flight.
 *
 * `latest.test.ts` resolves responses deliberately out of order and asserts the
 * newest wins regardless of arrival order.
 */

export interface Ticket<I> {
  readonly id: number;
  /** The inputs this request was made under, frozen at `begin`. */
  readonly inputs: I;
  /** True only while this is still the most recent ticket issued. */
  readonly current: boolean;
}

export class Latest<I> {
  #id = 0;
  #inFlight = 0;

  /** Open a request. Every earlier ticket becomes stale immediately. */
  begin(inputs: I): Ticket<I> {
    this.#id += 1;
    this.#inFlight += 1;
    const id = this.#id;
    const frozen = Object.freeze({ ...inputs });
    const self = this;
    return {
      id,
      inputs: frozen,
      get current(): boolean {
        return self.#id === id;
      },
    };
  }

  /**
   * Close a request. Returns true when this ticket is still the newest, i.e.
   * when the caller may render and clear the busy state.
   */
  settle(ticket: Ticket<I>): boolean {
    this.#inFlight = Math.max(0, this.#inFlight - 1);
    return this.#id === ticket.id;
  }

  /** True while any request is outstanding, stale ones included. */
  get busy(): boolean {
    return this.#inFlight > 0;
  }

  /** The id of the newest ticket issued, for tests and diagnostics. */
  get currentId(): number {
    return this.#id;
  }
}

/**
 * Mark a region busy for assistive technology while its contents are being
 * replaced. `aria-busy` tells a screen reader to hold its announcement until the
 * region settles, instead of reading a half-built result.
 */
export function setBusy(node: HTMLElement, busy: boolean): void {
  if (busy) node.setAttribute('aria-busy', 'true');
  else node.removeAttribute('aria-busy');
}
