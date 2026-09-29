/**
 * Trails, differentials, and the reachable sets the impossible differential is
 * built from. Nothing here searches automatically for a *good* trail in the
 * SAT/MILP sense — on an 8-bit block the whole difference space is 256 values,
 * so every quantity below is computed by exhaustion over it, exactly.
 *
 * WHERE A DIFFERENCE IS MEASURED matters, and getting it wrong is the single
 * easiest way to produce a false impossibility claim. Two points per round:
 *
 *   layerOut  — immediately after a round's S-box layer, before its permutation
 *   layerIn   — at the input of the NEXT round's S-box layer, i.e. permuted
 *
 * A key XOR never changes a difference, so `layerIn` of round r+1 is exactly
 * `permute(layerOut of round r)`. The two sets in a miss-in-the-middle argument
 * must be compared at the SAME point; comparing a forward `layerOut` against a
 * backward `layerIn` differs by one permutation and reports impossibilities
 * that are not there. Both sets here are `layerIn` sets.
 *
 * The last round has no permutation, so an R-round ciphertext difference is the
 * `layerOut` of round R.
 */

import { BLOCK_SIZE } from './spn.ts';
import { permute, permuteInverse } from './permutation.ts';
import { layerProbability, layerSupport, type Table } from './tables.ts';

/** One S-box layer of a trail: the difference in, the difference out, and the cost. */
export interface TrailStep {
  readonly round: number;
  /** Difference at the input of this round's S-box layer. */
  readonly inDiff: number;
  /** Difference at the output of this round's S-box layer. */
  readonly outDiff: number;
  /** DDT entry for the high nibble (of 16). */
  readonly ddtHigh: number;
  /** DDT entry for the low nibble (of 16). */
  readonly ddtLow: number;
  /** ddtHigh/16 * ddtLow/16. */
  readonly probability: number;
}

export interface Trail {
  readonly rounds: number;
  readonly alpha: number;
  readonly delta: number;
  readonly steps: readonly TrailStep[];
  /** Product of the steps' probabilities: the single-trail prediction. */
  readonly probability: number;
}

/** The step detail for one S-box layer crossing. */
export function describeStep(ddt: Table, round: number, inDiff: number, outDiff: number): TrailStep {
  const ih = (inDiff >> 4) & 0xf;
  const il = inDiff & 0xf;
  const oh = (outDiff >> 4) & 0xf;
  const ol = outDiff & 0xf;
  return {
    round,
    inDiff,
    outDiff,
    ddtHigh: ddt[ih][oh],
    ddtLow: ddt[il][ol],
    probability: (ddt[ih][oh] / 16) * (ddt[il][ol] / 16),
  };
}

/**
 * Best-trail and exact-differential probability tables over `rounds` S-box
 * layers, for every (alpha, delta) pair at once.
 *
 *   trail[a][d]        — the single most probable trail from a to d: the product
 *                        of DDT entries a cryptanalyst quotes as "p".
 *   differential[a][d] — the sum over EVERY trail from a to d. This is the real
 *                        probability of the differential under the standard
 *                        Markov-cipher assumption of independent round keys,
 *                        and it is what a measurement converges to. Act 1 is
 *                        the gap between these two columns.
 *
 * Both are indexed by the R-round ciphertext difference, i.e. `layerOut` of the
 * last round.
 */
export interface RoundTables {
  readonly rounds: number;
  readonly trail: readonly Float64Array[];
  readonly differential: readonly Float64Array[];
}

export function roundTables(ddt: Table, maxRounds: number): RoundTables[] {
  const out: RoundTables[] = [];
  let trail: Float64Array[] = [];
  let differential: Float64Array[] = [];
  for (let d = 0; d < BLOCK_SIZE; d++) {
    trail.push(new Float64Array(BLOCK_SIZE));
    differential.push(new Float64Array(BLOCK_SIZE));
  }
  for (let a = 1; a < BLOCK_SIZE; a++) {
    for (let d = 0; d < BLOCK_SIZE; d++) {
      const p = layerProbability(ddt, a, d);
      trail[a][d] = p;
      differential[a][d] = p;
    }
  }
  out.push({ rounds: 1, trail, differential });
  for (let r = 2; r <= maxRounds; r++) {
    const prevTrail = trail;
    const prevDiff = differential;
    const nextTrail: Float64Array[] = [];
    const nextDiff: Float64Array[] = [];
    for (let d = 0; d < BLOCK_SIZE; d++) {
      nextTrail.push(new Float64Array(BLOCK_SIZE));
      nextDiff.push(new Float64Array(BLOCK_SIZE));
    }
    for (let a = 1; a < BLOCK_SIZE; a++) {
      for (const mid of layerSupport(ddt, a)) {
        if (mid === 0) continue;
        const p = layerProbability(ddt, a, mid);
        const rowT = prevTrail[permute(mid)];
        const rowD = prevDiff[permute(mid)];
        for (let d = 0; d < BLOCK_SIZE; d++) {
          if (rowT[d] > 0) {
            const v = p * rowT[d];
            if (v > nextTrail[a][d]) nextTrail[a][d] = v;
          }
          if (rowD[d] > 0) nextDiff[a][d] += p * rowD[d];
        }
      }
    }
    trail = nextTrail;
    differential = nextDiff;
    out.push({ rounds: r, trail, differential });
  }
  return out;
}

/** The highest-probability trail over `rounds` layers, and where it goes. */
export interface BestDifferential {
  readonly rounds: number;
  readonly alpha: number;
  readonly delta: number;
  readonly trailProbability: number;
  readonly differentialProbability: number;
}

export function bestDifferential(tables: RoundTables): BestDifferential {
  let bp = 0;
  let ba = 0;
  let bd = 0;
  for (let a = 1; a < BLOCK_SIZE; a++) {
    for (let d = 1; d < BLOCK_SIZE; d++) {
      if (tables.trail[a][d] > bp) {
        bp = tables.trail[a][d];
        ba = a;
        bd = d;
      }
    }
  }
  return {
    rounds: tables.rounds,
    alpha: ba,
    delta: bd,
    trailProbability: bp,
    differentialProbability: tables.differential[ba][bd],
  };
}

/**
 * Recover the actual best trail (the sequence of round differences) achieving
 * `tables.trail[alpha][delta]`, so the page can show the trail rather than only
 * its probability.
 */
export function reconstructTrail(
  ddt: Table,
  all: readonly RoundTables[],
  rounds: number,
  alpha: number,
  delta: number
): Trail {
  const steps: TrailStep[] = [];
  let current = alpha;
  for (let r = 0; r < rounds; r++) {
    const remaining = rounds - r - 1;
    let bestOut = -1;
    let bestValue = -1;
    for (const out of layerSupport(ddt, current)) {
      const here = layerProbability(ddt, current, out);
      if (here === 0) continue;
      const rest = remaining === 0 ? (out === delta ? 1 : 0) : all[remaining - 1].trail[permute(out)][delta];
      const value = here * rest;
      if (value > bestValue) {
        bestValue = value;
        bestOut = out;
      }
    }
    if (bestOut < 0 || bestValue <= 0) {
      return { rounds, alpha, delta, steps, probability: 0 };
    }
    steps.push(describeStep(ddt, r + 1, current, bestOut));
    current = permute(bestOut);
  }
  return {
    rounds,
    alpha,
    delta,
    steps,
    probability: steps.reduce((acc, s) => acc * s.probability, 1),
  };
}

/**
 * The COMPLETE set of differences that `alpha` can reach at the input of S-box
 * layer `layers + 1` — a probability-1 statement, because it is the whole
 * support rather than a sample of it.
 *
 * KEY INDEPENDENCE, which is the whole force of the impossible differential.
 * A round key is XORed in before the S-box, so it changes which plaintexts
 * realise a crossing but never which crossings exist: the set of nonzero DDT
 * entries is a property of the S-box alone. So this set is the same for all
 * 65536 keys, including the ones no enumeration ever touches.
 */
export function forwardSet(ddt: Table, alpha: number, layers: number): Set<number> {
  let current = new Set<number>([alpha & 0xff]);
  for (let i = 0; i < layers; i++) {
    const next = new Set<number>();
    for (const d of current) for (const out of layerSupport(ddt, d)) next.add(permute(out));
    current = next;
  }
  return current;
}

/**
 * The COMPLETE set of differences at the input of S-box layer `R - layers + 1`
 * from which the last `layers` layers can produce the ciphertext difference
 * `delta`. The mirror of `forwardSet`, and measured at the same kind of point.
 */
export function backwardSet(ddt: Table, delta: number, layers: number): Set<number> {
  let current = new Set<number>([delta & 0xff]);
  for (let i = 0; i < layers; i++) {
    const next = new Set<number>();
    for (const out of current) {
      const target = i > 0 ? permuteInverse(out) : out;
      for (let d = 1; d < BLOCK_SIZE; d++) {
        if (layerProbability(ddt, d, target) > 0) next.add(d);
      }
    }
    current = next;
  }
  return current;
}

/**
 * Every ciphertext difference an R-round encryption can produce from `alpha`,
 * over every key. The complement is the set of impossible differentials.
 */
export function reachableCiphertextDiffs(ddt: Table, alpha: number, rounds: number): Set<number> {
  let current = new Set<number>([alpha & 0xff]);
  for (let i = 0; i < rounds; i++) {
    const next = new Set<number>();
    for (const d of current) {
      for (const out of layerSupport(ddt, d)) next.add(i < rounds - 1 ? permute(out) : out);
    }
    current = next;
  }
  return current;
}

export interface MissInTheMiddle {
  readonly alpha: number;
  readonly delta: number;
  readonly rounds: number;
  /** S-box layers covered by the forward half. */
  readonly forwardLayers: number;
  /** S-box layers covered by the backward half. */
  readonly backwardLayers: number;
  /** Forward-reachable differences at the meeting point. */
  readonly forward: readonly number[];
  /** Backward-required differences at the same meeting point. */
  readonly backward: readonly number[];
  /** Differences in both — empty exactly when the differential is impossible. */
  readonly shared: readonly number[];
  readonly impossible: boolean;
}

/**
 * The miss-in-the-middle certificate for one (alpha, delta) over `rounds`
 * rounds, split after `forwardLayers` S-box layers.
 */
export function missInTheMiddle(
  ddt: Table,
  alpha: number,
  delta: number,
  rounds: number,
  forwardLayers: number
): MissInTheMiddle {
  const backwardLayers = rounds - forwardLayers;
  const forward = forwardSet(ddt, alpha, forwardLayers);
  const backward = backwardSet(ddt, delta, backwardLayers);
  const shared = [...forward].filter((x) => backward.has(x)).sort((a, b) => a - b);
  return {
    alpha,
    delta,
    rounds,
    forwardLayers,
    backwardLayers,
    forward: [...forward].sort((a, b) => a - b),
    backward: [...backward].sort((a, b) => a - b),
    shared,
    impossible: shared.length === 0,
  };
}

/**
 * The split that gives the smallest forward set — the most legible certificate,
 * not a different claim. Impossibility does not depend on where you cut: if
 * the two halves miss at one split they miss at every split, because both are
 * complete supports of the same set of paths.
 */
export function bestSplit(ddt: Table, alpha: number, delta: number, rounds: number): MissInTheMiddle {
  let best: MissInTheMiddle | null = null;
  for (let f = 1; f < rounds; f++) {
    const m = missInTheMiddle(ddt, alpha, delta, rounds, f);
    if (!m.impossible) continue;
    if (!best || m.forward.length < best.forward.length) best = m;
  }
  return best ?? missInTheMiddle(ddt, alpha, delta, rounds, Math.max(1, Math.floor(rounds / 2)));
}
