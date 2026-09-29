import { describe, expect, it } from 'vitest';
import { getSbox } from './sbox.ts';
import { layerProbability, tablesFor } from './tables.ts';
import { permute, permuteInverse } from './permutation.ts';
import { BLOCK_SIZE, encryptCodebook, generateKey } from './spn.ts';
import {
  backwardSet,
  bestDifferential,
  bestSplit,
  forwardSet,
  missInTheMiddle,
  reachableCiphertextDiffs,
  reconstructTrail,
  roundTables,
} from './trails.ts';

const weak = getSbox('weak');
const strong = getSbox('strong');
const W = tablesFor(weak);
const S = tablesFor(strong);
const wTables = roundTables(W.ddt, 6);
const sTables = roundTables(S.ddt, 6);

/**
 * GROUND TRUTH, and the most important test in this file.
 *
 * `reachableCiphertextDiffs` is a claim about all 65536 keys derived from the
 * S-box's DDT support alone. This enumerates the actual cipher over EVERY
 * master key and every plaintext pair, and asserts the two sets are identical -
 * not merely that the prediction is a safe over-estimate.
 *
 * Both directions matter. A difference the cipher produces but the prediction
 * calls impossible would make every impossibility claim on the page false. A
 * difference the prediction allows but the cipher never produces would make the
 * prediction loose, and a loose "support" is one that can never be contradicted,
 * which is worth no more than a disclaimer.
 */
function exhaustiveAchievable(alpha: number, rounds: number, sbox = weak): Set<number> {
  const seen = new Uint8Array(BLOCK_SIZE);
  for (let mk = 0; mk < 1 << 16; mk++) {
    const book = encryptCodebook(generateKey(mk), sbox, rounds);
    for (let p = 0; p < BLOCK_SIZE; p++) {
      const q = p ^ alpha;
      if (q < p) continue;
      seen[book[p] ^ book[q]] = 1;
    }
  }
  const out = new Set<number>();
  for (let d = 1; d < BLOCK_SIZE; d++) if (seen[d]) out.add(d);
  return out;
}

describe('reachability is exactly what the cipher can do, over every key', () => {
  it('matches exhaustive enumeration over all 65536 keys, alpha=0x0a, R=3', () => {
    const predicted = reachableCiphertextDiffs(W.ddt, 0x0a, 3);
    const truth = exhaustiveAchievable(0x0a, 3);
    expect([...truth].filter((d) => !predicted.has(d))).toEqual([]);
    expect([...predicted].filter((d) => !truth.has(d))).toEqual([]);
    expect(truth.size).toBe(225);
  }, 120_000);

  it('matches exhaustive enumeration over all 65536 keys, alpha=0x01, R=3', () => {
    const predicted = reachableCiphertextDiffs(W.ddt, 0x01, 3);
    const truth = exhaustiveAchievable(0x01, 3);
    expect([...truth].filter((d) => !predicted.has(d))).toEqual([]);
    expect([...predicted].filter((d) => !truth.has(d))).toEqual([]);
    expect(truth.size).toBe(237);
  }, 120_000);

  it('matches exhaustive enumeration for the PRESENT S-box too, alpha=0x0a, R=3', () => {
    const predicted = reachableCiphertextDiffs(S.ddt, 0x0a, 3);
    const truth = exhaustiveAchievable(0x0a, 3, strong);
    expect([...truth].filter((d) => !predicted.has(d))).toEqual([]);
    expect([...predicted].filter((d) => !truth.has(d))).toEqual([]);
  }, 120_000);
});

describe('Act 2: the 3-round impossible differential', () => {
  it('rules out exactly the 30 single-active-nibble differences from alpha=0x0a', () => {
    const reachable = reachableCiphertextDiffs(W.ddt, 0x0a, 3);
    const impossible: number[] = [];
    for (let d = 1; d < BLOCK_SIZE; d++) if (!reachable.has(d)) impossible.push(d);
    const oneNibbleActive: number[] = [];
    for (let d = 1; d < BLOCK_SIZE; d++) {
      const hi = (d >> 4) & 0xf;
      const lo = d & 0xf;
      if ((hi === 0) !== (lo === 0)) oneNibbleActive.push(d);
    }
    expect(impossible).toEqual(oneNibbleActive);
    expect(impossible).toHaveLength(30);
  });

  it('carries a miss-in-the-middle certificate with an empty intersection', () => {
    const m = bestSplit(W.ddt, 0x0a, 0x01, 3);
    expect(m.impossible).toBe(true);
    expect(m.shared).toEqual([]);
    expect(m.forwardLayers + m.backwardLayers).toBe(3);
    expect(m.forward).toEqual([0x04, 0x08, 0x4c, 0x80, 0x8c]);
  });

  it('is impossible at every split, not just the smallest one', () => {
    // Impossibility is a property of the path set, not of where you cut it.
    for (let f = 1; f < 3; f++) {
      expect(missInTheMiddle(W.ddt, 0x0a, 0x01, 3, f).impossible).toBe(true);
    }
  });

  it('finds no impossible differential across the full four rounds, for any alpha', () => {
    // The honest scope of Act 2, and the reason Act 3 sieves the last round
    // instead of distinguishing the whole cipher.
    for (const sbox of [W, S]) {
      for (let a = 1; a < BLOCK_SIZE; a++) {
        expect(reachableCiphertextDiffs(sbox.ddt, a, 4).size).toBe(255);
      }
    }
  });

  it('reports a possible differential as possible', () => {
    const m = bestSplit(W.ddt, 0x0a, 0x11, 3);
    expect(m.impossible).toBe(false);
    expect(m.shared.length).toBeGreaterThan(0);
  });
});

describe('forward and backward sets meet at the same point', () => {
  it('the forward set is the permuted image of the previous layer output', () => {
    // The permutation alignment that a miss-in-the-middle argument gets wrong
    // by one step if the two sets are read at different points.
    for (const alpha of [0x01, 0x0a, 0xb0]) {
      const f1 = forwardSet(W.ddt, alpha, 1);
      for (const x of f1) {
        const beforePermute = permuteInverse(x);
        expect(layerProbability(W.ddt, alpha, beforePermute)).toBeGreaterThan(0);
      }
    }
  });

  it('the backward set over one layer is every difference that can produce delta', () => {
    for (const delta of [0x01, 0x50, 0xd0]) {
      const b = backwardSet(W.ddt, delta, 1);
      for (let d = 1; d < BLOCK_SIZE; d++) {
        expect(b.has(d)).toBe(layerProbability(W.ddt, d, delta) > 0);
      }
    }
  });

  it('a difference in both sets really does complete a trail', () => {
    // If the sets overlap the differential is possible, and the witness is
    // constructible - which is what makes an empty overlap a proof rather than a
    // failure to search hard enough.
    const m = missInTheMiddle(W.ddt, 0x0a, 0x11, 3, 1);
    expect(m.shared.length).toBeGreaterThan(0);
    const mid = m.shared[0];
    expect(layerProbability(W.ddt, 0x0a, permuteInverse(mid))).toBeGreaterThan(0);
    expect(wTables[1].differential[mid][0x11]).toBeGreaterThan(0);
  });
});

describe('Act 1: trail probability versus differential probability', () => {
  const expected: [number, number, number, string, string][] = [
    [1, 0x0b, 0x02, '2^-1.00', '2^-1.00'],
    [2, 0xb0, 0x05, '2^-2.42', '2^-2.42'],
    [3, 0xb0, 0xd0, '2^-3.83', '2^-3.79'],
    [4, 0xb0, 0x50, '2^-6.83', '2^-6.44'],
    [5, 0xb0, 0x90, '2^-8.83', '2^-7.56'],
    [6, 0xb0, 0x05, '2^-11.25', '2^-7.91'],
  ];

  it.each(expected)(
    'R=%i: best trail %s, differential %s',
    (rounds, alpha, delta, trailLabel, diffLabel) => {
      const best = bestDifferential(wTables[rounds - 1]);
      expect(best.alpha).toBe(alpha);
      expect(best.delta).toBe(delta);
      expect(`2^${Math.log2(best.trailProbability).toFixed(2)}`).toBe(trailLabel);
      expect(`2^${Math.log2(best.differentialProbability).toFixed(2)}`).toBe(diffLabel);
    }
  );

  it('the differential is never less probable than its best single trail', () => {
    for (let r = 1; r <= 6; r++) {
      for (let a = 1; a < BLOCK_SIZE; a += 13) {
        for (let d = 1; d < BLOCK_SIZE; d += 13) {
          expect(wTables[r - 1].differential[a][d]).toBeGreaterThanOrEqual(
            wTables[r - 1].trail[a][d] - 1e-15
          );
        }
      }
    }
  });

  it('the gap between trail and differential opens as rounds grow', () => {
    // The Act 1 result: a single trail stops being the differential. Stated as a
    // monotone comparison of the ratio, not a hand-picked pair.
    const ratios = [1, 2, 3, 4, 5, 6].map((r) => {
      const b = bestDifferential(wTables[r - 1]);
      return b.differentialProbability / b.trailProbability;
    });
    expect(ratios[0]).toBeCloseTo(1, 12);
    expect(ratios[5]).toBeGreaterThan(9);
    for (let i = 1; i < ratios.length; i++) expect(ratios[i]).toBeGreaterThanOrEqual(ratios[i - 1] - 1e-12);
  });

  it('every row of a differential table sums to 1: the differences all go somewhere', () => {
    for (let r = 1; r <= 6; r++) {
      for (let a = 1; a < BLOCK_SIZE; a += 29) {
        let total = 0;
        for (let d = 0; d < BLOCK_SIZE; d++) total += wTables[r - 1].differential[a][d];
        expect(total).toBeCloseTo(1, 9);
      }
    }
  });

  it('the best differential falls below one right pair in the full codebook at five rounds', () => {
    const pairs = BLOCK_SIZE / 2;
    const counts = [1, 2, 3, 4, 5, 6].map(
      (r) => pairs * bestDifferential(wTables[r - 1]).differentialProbability
    );
    expect(counts[3]).toBeGreaterThan(1);
    expect(counts[4]).toBeLessThan(1);
  });

  it('the PRESENT S-box decays faster than the textbook one at every round count', () => {
    for (let r = 1; r <= 6; r++) {
      expect(bestDifferential(sTables[r - 1]).trailProbability).toBeLessThanOrEqual(
        bestDifferential(wTables[r - 1]).trailProbability
      );
    }
  });
});

describe('reconstructTrail', () => {
  it('rebuilds a trail whose probability equals the table entry', () => {
    for (let r = 1; r <= 6; r++) {
      const best = bestDifferential(wTables[r - 1]);
      const trail = reconstructTrail(W.ddt, wTables, r, best.alpha, best.delta);
      expect(trail.steps).toHaveLength(r);
      expect(trail.probability).toBeCloseTo(best.trailProbability, 15);
    }
  });

  it('chains its own steps: each step starts where the last one landed, permuted', () => {
    const best = bestDifferential(wTables[3]);
    const trail = reconstructTrail(W.ddt, wTables, 4, best.alpha, best.delta);
    expect(trail.steps[0].inDiff).toBe(best.alpha);
    for (let i = 1; i < trail.steps.length; i++) {
      expect(trail.steps[i].inDiff).toBe(permute(trail.steps[i - 1].outDiff));
    }
    expect(trail.steps[trail.steps.length - 1].outDiff).toBe(best.delta);
  });

  it('returns probability zero for a differential with no trail', () => {
    const trail = reconstructTrail(W.ddt, wTables, 3, 0x0a, 0x01);
    expect(trail.probability).toBe(0);
  });
});
