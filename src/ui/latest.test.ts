import { describe, expect, it } from 'vitest';
import { Latest } from './latest.ts';

/**
 * The reordering these tests simulate is the real hazard: a Worker answering an
 * older request after a newer one. Asserted directly on the mechanism, because
 * a browser test cannot reliably force a Worker to answer out of order.
 */
describe('Latest: the newest request wins regardless of arrival order', () => {
  it('a stale ticket knows it is stale', () => {
    const l = new Latest<{ sbox: string }>();
    const first = l.begin({ sbox: 'weak' });
    expect(first.current).toBe(true);
    const second = l.begin({ sbox: 'strong' });
    expect(first.current).toBe(false);
    expect(second.current).toBe(true);
  });

  it('settle() authorises only the newest ticket, even when it settles FIRST', () => {
    const l = new Latest<{ n: number }>();
    const a = l.begin({ n: 1 });
    const b = l.begin({ n: 2 });
    // b answers first, then a: the out-of-order case.
    expect(l.settle(b)).toBe(true);
    expect(l.settle(a)).toBe(false);
  });

  it('settle() authorises only the newest ticket when they settle in order', () => {
    const l = new Latest<{ n: number }>();
    const a = l.begin({ n: 1 });
    const b = l.begin({ n: 2 });
    expect(l.settle(a)).toBe(false);
    expect(l.settle(b)).toBe(true);
  });

  it('survives twenty rapid requests: exactly one is authorised, and it is the last', () => {
    const l = new Latest<{ n: number }>();
    const tickets = Array.from({ length: 20 }, (_, i) => l.begin({ n: i }));
    // Settle in a scrambled order.
    const order = [7, 3, 19, 0, 11, 5, 18, 2, 14, 9, 1, 16, 4, 12, 8, 17, 6, 13, 10, 15];
    const authorised = order.filter((i) => l.settle(tickets[i]));
    expect(authorised).toEqual([19]);
  });

  it('carries an immutable snapshot of the inputs the request was made under', () => {
    const l = new Latest<{ sbox: string; keys: number }>();
    const live = { sbox: 'weak', keys: 256 };
    const t = l.begin(live);
    // The caller mutates its own state afterwards, as a control handler would.
    live.sbox = 'strong';
    live.keys = 4096;
    expect(t.inputs.sbox).toBe('weak');
    expect(t.inputs.keys).toBe(256);
    expect(Object.isFrozen(t.inputs)).toBe(true);
  });

  it('stays busy until every request has settled, stale ones included', () => {
    const l = new Latest<{ n: number }>();
    const a = l.begin({ n: 1 });
    const b = l.begin({ n: 2 });
    expect(l.busy).toBe(true);
    l.settle(b);
    // b was the newest, but a is still in flight: the panel is not settled.
    expect(l.busy).toBe(true);
    l.settle(a);
    expect(l.busy).toBe(false);
  });

  it('a dropped response cannot clear the busy state on its own', () => {
    // The specific defect: a stale answer arriving last must not tell a reader
    // the panel has finished when it holds the newest answer already.
    const l = new Latest<{ n: number }>();
    const a = l.begin({ n: 1 });
    const b = l.begin({ n: 2 });
    expect(l.settle(b)).toBe(true);
    const staleMayRender = l.settle(a);
    expect(staleMayRender).toBe(false);
  });
});
