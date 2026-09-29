/**
 * The two tables this lab lives on, both computed from the S-box in the page.
 *
 * DDT — the Difference Distribution Table of Biham and Shamir's differential
 * cryptanalysis:
 *
 *     DDT[a][b] = #{ x in 0..15 : S(x) XOR S(x XOR a) = b }
 *
 * Every row sums to 16, because for a fixed input difference each of the 16
 * inputs produces exactly one output difference. `DDT[a][b] = 0` is the
 * statement Act 2 is built on: that crossing can never happen, for any key.
 *
 * BCT — the Boomerang Connectivity Table of Cid, Huang, Peyrin, Sasaki and
 * Song, "Boomerang Connectivity Table: A New Cryptanalysis Tool", EUROCRYPT
 * 2018:
 *
 *     BCT[a][b] = #{ x : S^-1(S(x) XOR b) XOR S^-1(S(x XOR a) XOR b) = a }
 *
 * Read it as the boomerang's round trip through one S-box: go in with
 * difference `a`, come back with the ciphertext-side difference `b` applied,
 * and ask whether the difference on the way back out is `a` again. That is
 * exactly the event Act 5 measures, so the BCT is not an analogy for the
 * measurement — it is its definition.
 *
 * Three identities hold for any permutation S, and `tables.test.ts` checks all
 * three by brute force rather than trusting them:
 *
 *   1. BCT[a][0] = BCT[0][b] = 2^n. With b = 0 the two S^-1 calls undo their
 *      own S calls, so the difference is `a` for every x. With a = 0 the two
 *      terms are literally the same expression, so the difference is 0 = a.
 *   2. BCT >= DDT pointwise. If S(x) XOR S(x XOR a) = b then the first S^-1
 *      lands on x XOR a and the second on x, so their XOR is a. Every x the
 *      DDT counts, the BCT counts too. This one has teeth: it means a
 *      single-S-box switch can only ever HELP the boomerang, never hurt it.
 *   3. BCT entries are even for a != 0, because x and x XOR a are solutions
 *      together.
 */

import type { Sbox } from './sbox.ts';

export const NIBBLE_VALUES = 16;

export type Table = readonly (readonly number[])[];

export function computeDDT(sbox: Sbox): number[][] {
  const t = Array.from({ length: NIBBLE_VALUES }, () => new Array<number>(NIBBLE_VALUES).fill(0));
  for (let a = 0; a < NIBBLE_VALUES; a++) {
    for (let x = 0; x < NIBBLE_VALUES; x++) {
      t[a][sbox.table[x] ^ sbox.table[x ^ a]]++;
    }
  }
  return t;
}

export function computeBCT(sbox: Sbox): number[][] {
  const t = Array.from({ length: NIBBLE_VALUES }, () => new Array<number>(NIBBLE_VALUES).fill(0));
  const S = sbox.table;
  const Si = sbox.inverse;
  for (let a = 0; a < NIBBLE_VALUES; a++) {
    for (let b = 0; b < NIBBLE_VALUES; b++) {
      let count = 0;
      for (let x = 0; x < NIBBLE_VALUES; x++) {
        if ((Si[S[x] ^ b] ^ Si[S[x ^ a] ^ b]) === a) count++;
      }
      t[a][b] = count;
    }
  }
  return t;
}

/** Both tables for one S-box, memoised per S-box identity. */
export interface Tables {
  readonly ddt: Table;
  readonly bct: Table;
  readonly maxDdt: number;
  readonly maxBct: number;
}

const cache = new WeakMap<Sbox, Tables>();

export function tablesFor(sbox: Sbox): Tables {
  const hit = cache.get(sbox);
  if (hit) return hit;
  const ddt = computeDDT(sbox);
  const bct = computeBCT(sbox);
  let maxDdt = 0;
  let maxBct = 0;
  for (let a = 1; a < NIBBLE_VALUES; a++) {
    for (let b = 1; b < NIBBLE_VALUES; b++) {
      if (ddt[a][b] > maxDdt) maxDdt = ddt[a][b];
      if (bct[a][b] > maxBct) maxBct = bct[a][b];
    }
  }
  const out: Tables = { ddt, bct, maxDdt, maxBct };
  cache.set(sbox, out);
  return out;
}

/** The high and low nibbles of a byte-wide difference. */
export function nibbles(byte: number): [number, number] {
  return [(byte >> 4) & 0xf, byte & 0xf];
}

/**
 * The probability that the byte-wide difference `from` becomes `to` across one
 * S-box layer: the product of the two nibbles' DDT entries over 16 each. Zero
 * for any nibble whose crossing has a zero DDT entry — including the two
 * structural zeros, an inactive nibble that must stay inactive and an active
 * one that cannot go quiet.
 */
export function layerProbability(ddt: Table, from: number, to: number): number {
  const [fh, fl] = nibbles(from);
  const [th, tl] = nibbles(to);
  return (ddt[fh][th] / NIBBLE_VALUES) * (ddt[fl][tl] / NIBBLE_VALUES);
}

/** Every byte-wide difference reachable from `from` across one S-box layer. */
export function layerSupport(ddt: Table, from: number): number[] {
  const [fh, fl] = nibbles(from);
  const out: number[] = [];
  for (let h = 0; h < NIBBLE_VALUES; h++) {
    if (ddt[fh][h] === 0) continue;
    for (let l = 0; l < NIBBLE_VALUES; l++) {
      if (ddt[fl][l] === 0) continue;
      out.push((h << 4) | l);
    }
  }
  return out;
}

/**
 * The boomerang switch probability across one S-box LAYER (both nibbles), from
 * the BCT. This is Cid et al.'s `r` for a single switching layer, and the only
 * thing this lab claims the BCT for — see the honesty panel.
 */
export function switchProbabilityBCT(bct: Table, beta: number, gamma: number): number {
  const [bh, bl] = nibbles(beta);
  const [gh, gl] = nibbles(gamma);
  return (bct[bh][gh] / NIBBLE_VALUES) * (bct[bl][gl] / NIBBLE_VALUES);
}

/**
 * What a trail-based reading of the same switch predicts: the DDT probability
 * of crossing beta -> gamma, paid TWICE, once for the forward pair and once for
 * the backward pair, as Wagner's p^2q^2 does when the switching layer is
 * absorbed into one half. Act 5 measures which of the two is right.
 */
export function switchProbabilityTrail(ddt: Table, beta: number, gamma: number): number {
  const one = layerProbability(ddt, beta, gamma);
  return one * one;
}
