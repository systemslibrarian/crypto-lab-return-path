import { describe, expect, it } from 'vitest';
import { getSbox } from './sbox.ts';
import { tablesFor } from './tables.ts';
import { BLOCK_SIZE, generateKey } from './spn.ts';
import { bestTrail, roundTables } from './trails.ts';
import {
  MASTER_KEY_SPACE,
  RANDOM_RETURN_RATE,
  clusterInterval,
  decomposeBoomerang,
  findQuartet,
  findQuartetAcrossKeys,
  measureDifferential,
  measureImpossibility,
  measureSwitch,
  runBoomerang,
  runBoomerangNull,
  runSieve,
  wilsonInterval,
} from './experiments.ts';

const weak = getSbox('weak');
const W = tablesFor(weak);
const wTables = roundTables(W.ddt, 6);

describe('Act 1: measured differential probability', () => {
  it('lands on the differential prediction, not the single-trail one, at R=6', () => {
    // The whole point of Act 1. The single trail predicts 2^-11.25; the sum over
    // trails predicts 2^-7.91; the cipher does what the sum says.
    const best = bestTrail(wTables[5]);
    const m = measureDifferential(best.alpha, best.delta, 6, weak, 4096, 20260929);
    const measured = m.hits / m.pairs;
    expect(Math.abs(Math.log2(measured) - Math.log2(best.differentialProbability))).toBeLessThan(0.12);
    expect(Math.log2(measured) - Math.log2(best.trailProbability)).toBeGreaterThan(3);
  });

  it('agrees with prediction to within 0.15 bits at every round count', () => {
    for (let r = 1; r <= 6; r++) {
      const best = bestTrail(wTables[r - 1]);
      const m = measureDifferential(best.alpha, best.delta, r, weak, 4096, 777 + r);
      const measured = m.hits / m.pairs;
      expect(
        Math.abs(Math.log2(measured) - Math.log2(best.differentialProbability))
      ).toBeLessThan(0.15);
    }
  });

  it('reports pairs, not keys, as its sample size', () => {
    const m = measureDifferential(0x0b, 0x02, 1, weak, 100, 5);
    expect(m.keysUsed).toBe(100);
    expect(m.pairs).toBe(100 * (BLOCK_SIZE / 2));
  });

  it('is exact over the whole key space: R=1 alpha=0x0b delta=0x02 is exactly 1/2', () => {
    // DDT[b][2] = 8 of 16 and the high nibble is inactive, so the one-round
    // differential holds for exactly half of all pairs under every key.
    const m = measureDifferential(0x0b, 0x02, 1, weak, MASTER_KEY_SPACE, 1);
    expect(m.keysUsed).toBe(MASTER_KEY_SPACE);
    expect(m.hits * 2).toBe(m.pairs);
  }, 120_000);
});

describe('Act 2: the impossible differential, exhaustively', () => {
  it('sees zero occurrences across all 65536 keys and all 128 pairs', () => {
    const r = measureImpossibility(0x0a, 0x01, 3, weak, W.ddt, MASTER_KEY_SPACE, 1);
    expect(r.predictedImpossible).toBe(true);
    expect(r.occurrences).toBe(0);
    expect(r.pairs).toBe(MASTER_KEY_SPACE * (BLOCK_SIZE / 2));
    expect(r.exhaustiveOverKeys).toBe(true);
  }, 120_000);

  it('confirms the prediction is tight: every reachable difference really occurs', () => {
    // Without this, a "support" that claimed everything was reachable would pass
    // the impossibility check vacuously.
    const r = measureImpossibility(0x0a, 0x01, 3, weak, W.ddt, MASTER_KEY_SPACE, 1);
    expect(r.observedDistinct).toBe(r.predictedReachable);
    expect(r.predictedReachable).toBe(225);
  }, 120_000);

  it('reports a possible differential as occurring', () => {
    const r = measureImpossibility(0x0a, 0x11, 3, weak, W.ddt, 512, 9);
    expect(r.predictedImpossible).toBe(false);
    expect(r.occurrences).toBeGreaterThan(0);
  });

  it('finds every one of the 30 impossible differences at zero occurrences', () => {
    // Sampled keys rather than all 65536, thirty times over - the exhaustive run
    // above covers the key space for one delta, this covers every delta.
    for (let d = 1; d < BLOCK_SIZE; d++) {
      const hi = (d >> 4) & 0xf;
      const lo = d & 0xf;
      if ((hi === 0) === (lo === 0)) continue;
      const r = measureImpossibility(0x0a, d, 3, weak, W.ddt, 256, 4242);
      expect(r.predictedImpossible).toBe(true);
      expect(r.occurrences).toBe(0);
    }
  }, 60_000);
});

describe('Act 3: the impossible-differential key sieve', () => {
  it('I5: never eliminates the true subkey, over 400 keys', () => {
    for (let i = 0; i < 400; i++) {
      const key = generateKey((i * 7919 + 12345) & 0xffff);
      const r = runSieve([0x04, 0x0a], 4, weak, W.ddt, key, i + 1);
      expect(r.trueSubkeySurvived).toBe(true);
      expect(r.survivors).toContain(r.trueSubkey);
    }
  }, 120_000);

  it('I5 holds with a fixed seed and a fixed key too', () => {
    const key = generateKey(0xabcd);
    for (const seed of [1, 2, 3, 99, 123456]) {
      expect(runSieve([0x04, 0x0a], 4, weak, W.ddt, key, seed).trueSubkeySurvived).toBe(true);
    }
  });

  it('isolates the true subkey uniquely for all 400 keys with two input differences', () => {
    let unique = 0;
    for (let i = 0; i < 400; i++) {
      const key = generateKey((i * 7919 + 12345) & 0xffff);
      const r = runSieve([0x04, 0x0a], 4, weak, W.ddt, key, i + 1);
      if (r.survivors.length === 1) {
        unique++;
        expect(r.survivors[0]).toBe(r.trueSubkey);
      }
    }
    expect(unique).toBe(400);
  }, 120_000);

  it('recovers K_4, which for the four-round cipher is the low byte of the master key', () => {
    for (const mk of [0x0000, 0x1234, 0xabcd, 0xffff, 0x9e37]) {
      const key = generateKey(mk);
      const r = runSieve([0x04, 0x0a], 4, weak, W.ddt, key, 7);
      expect(r.trueSubkeyIndex).toBe(0);
      expect(r.trueSubkey).toBe(mk & 0xff);
      expect(r.survivors).toEqual([mk & 0xff]);
    }
  });

  it('the elimination curve only ever falls', () => {
    const r = runSieve([0x04, 0x0a], 4, weak, W.ddt, generateKey(0x5555), 11);
    expect(r.curve[0]).toBeLessThanOrEqual(BLOCK_SIZE);
    for (let i = 1; i < r.curve.length; i++) expect(r.curve[i]).toBeLessThanOrEqual(r.curve[i - 1]);
  });

  it('runs out of data rather than failing when one input difference is too weak', () => {
    // alpha = 0x01 rules out only 18 of 255 differences at four rounds, and a
    // single alpha offers just 128 pairs. Sometimes that is not enough, and the
    // honest report is an ambiguous survivor set - not a guess.
    let ambiguous = 0;
    for (let i = 0; i < 200; i++) {
      const key = generateKey((i * 4099 + 5) & 0xffff);
      const r = runSieve([0x01], 4, weak, W.ddt, key, i + 1);
      expect(r.trueSubkeySurvived).toBe(true);
      if (r.survivors.length > 1) ambiguous++;
    }
    expect(ambiguous).toBeGreaterThan(0);
  }, 60_000);

  it('the three-round sieve is far faster: a handful of pairs', () => {
    let total = 0;
    for (let i = 0; i < 100; i++) {
      const key = generateKey((i * 7919 + 12345) & 0xffff);
      const r = runSieve([0x0a], 3, weak, W.ddt, key, i + 1);
      expect(r.trueSubkeySurvived).toBe(true);
      total += r.pairsUsed;
    }
    expect(total / 100).toBeLessThan(15);
  });
});

describe('Act 4: the boomerang distinguisher', () => {
  it('returns far more often than a random permutation, with disjoint intervals', () => {
    const cipher = runBoomerang(0x0b, 0x50, 3, weak, 1500, 31337);
    const nullRun = runBoomerangNull(0x0b, 0x50, 1500, 909);
    expect(cipher.rate).toBeGreaterThan(3 * nullRun.rate);
    expect(cipher.ci[0]).toBeGreaterThan(nullRun.ci[1]);
  });

  it('the random-permutation null sits on the derived rate', () => {
    const nullRun = runBoomerangNull(0x0b, 0x50, 3000, 4242);
    expect(Math.abs(nullRun.rate - RANDOM_RETURN_RATE)).toBeLessThan(3e-4);
    expect(nullRun.ci[0]).toBeLessThan(RANDOM_RETURN_RATE);
    expect(nullRun.ci[1]).toBeGreaterThan(RANDOM_RETURN_RATE);
  });

  /**
   * THE NULL IS 1/(N-3), NOT 1/(N-1), AND THAT IS DERIVED HERE RATHER THAN
   * ASSERTED.
   *
   * The exclusion rule changes the answer: once the degenerate quartet is
   * dropped, P3 and P4 are two distinct plaintexts outside {P1, P2}, so P3 has
   * N-2 choices and P4 the N-3 that remain, exactly one of which is P3 XOR alpha.
   *
   * Rather than take that argument on trust, these enumerate EVERY permutation of
   * a 4- and an 8-element block -- 24 and 40 320 of them -- run the same quartet
   * procedure with the same exclusion, and confirm the exact rate. Two block
   * sizes, because one could be a coincidence and two pin the formula. 16! is out
   * of reach, which is why the argument above is what carries N = 256; the small
   * cases are what would catch it being wrong.
   */
  function exactNullRate(N: number): number {
    const ids = Array.from({ length: N }, (_, i) => i);
    let ret = 0;
    let tot = 0;
    const permute = (rest: number[], acc: number[]): void => {
      if (rest.length === 0) {
        const E = acc;
        const D = new Array<number>(N);
        for (let i = 0; i < N; i++) D[E[i]] = i;
        for (let a = 1; a < N; a++) {
          for (let d = 1; d < N; d++) {
            for (let p1 = 0; p1 < N; p1++) {
              const p2 = p1 ^ a;
              if (p2 < p1) continue;
              const c1 = E[p1];
              const c2 = E[p2];
              if ((c1 ^ c2) === d) continue; // the same exclusion the experiment uses
              tot++;
              if ((D[c1 ^ d] ^ D[c2 ^ d]) === a) ret++;
            }
          }
        }
        return;
      }
      for (let i = 0; i < rest.length; i++) {
        const next = rest.slice();
        const [x] = next.splice(i, 1);
        permute(next, [...acc, x]);
      }
    };
    permute(ids, []);
    return ret / tot;
  }

  it('is exactly 1/(N-3) over ALL 24 permutations of a 4-element block', () => {
    expect(exactNullRate(4)).toBe(1 / (4 - 3));
  });

  it('is exactly 1/(N-3) over ALL 40 320 permutations of an 8-element block', () => {
    const rate = exactNullRate(8);
    expect(rate).toBeCloseTo(1 / (8 - 3), 12);
    // And NOT the 1/(N-1) a reader expects, which is the whole point.
    expect(Math.abs(rate - 1 / (8 - 1))).toBeGreaterThan(0.05);
  }, 120_000);

  it('the constant the page prints follows that formula at the real block size', () => {
    expect(RANDOM_RETURN_RATE).toBe(1 / (BLOCK_SIZE - 3));
    expect(RANDOM_RETURN_RATE).not.toBe(1 / (BLOCK_SIZE - 1));
  });

  it('CLUSTERING: resampling keys gives a wider interval than pooling quartets', () => {
    // The quartets one key contributes share its subkeys, so pooling them treats
    // correlated events as independent ones. Measured, not argued.
    const r = runBoomerang(0x0b, 0x50, 3, weak, 512, 31337);
    const pooledWidth = r.ciPooled[1] - r.ciPooled[0];
    const clusterWidth = r.ci[1] - r.ci[0];
    expect(clusterWidth).toBeGreaterThan(pooledWidth);
    // Both must still bracket the point estimate the page reports.
    expect(r.ci[0]).toBeLessThanOrEqual(r.rate);
    expect(r.ci[1]).toBeGreaterThanOrEqual(r.rate);
  });

  it('CLUSTERING: the correction does not dissolve the distinguisher', () => {
    // The acceptance criterion for the fix: after widening, the cipher's interval
    // and the null's must still be disjoint at the SHIPPED default key count.
    const cipher = runBoomerang(0x0b, 0x50, 3, weak, 512, 31337);
    const nullRun = runBoomerangNull(0x0b, 0x50, 512, 0x5bd1 ^ 31337);
    expect(cipher.ci[0]).toBeGreaterThan(nullRun.ci[1]);
  });

  it('clusterInterval degrades to Wilson for a single cluster', () => {
    const one = clusterInterval([{ successes: 5, trials: 100 }]);
    const w = wilsonInterval(5, 100);
    expect(one).toEqual(w);
  });

  it('clusterInterval brackets the pooled ratio, not the mean of per-key rates', () => {
    // Keys contribute different numbers of quartets when degenerate ones are
    // excluded, so a mean of rates would silently upweight the small ones.
    const clusters = [
      { successes: 10, trials: 100 },
      { successes: 0, trials: 4 },
      { successes: 3, trials: 60 },
    ];
    const pooled = 13 / 164;
    const [lo, hi] = clusterInterval(clusters, 7, 3000);
    expect(lo).toBeLessThanOrEqual(pooled);
    expect(hi).toBeGreaterThanOrEqual(pooled);
  });

  it('p^2q^2 overstates the measured rate on this cipher', () => {
    // Honest result, not a decoration: p = 1/2, q = 3/16 and the switch is free,
    // so p^2q^2 predicts 3.52e-2; the cipher returns about half that.
    const p = 0.5;
    const q = 0.375;
    const predicted = p * p * q * q;
    const cipher = runBoomerang(0x0b, 0x50, 3, weak, 1500, 31337);
    expect(cipher.rate).toBeLessThan(predicted);
    expect(cipher.rate).toBeGreaterThan(predicted / 3);
  });

  it('excludes and counts degenerate quartets', () => {
    // delta = C1 XOR C2 makes the shifted pair the original pair swapped, which
    // returns for free. It happens at roughly the rate of the (alpha, delta)
    // differential, so on a high-probability differential it is common.
    const common = runBoomerang(0xb0, 0xd0, 3, weak, 400, 5);
    expect(common.degenerate).toBeGreaterThan(0);
    expect(common.quartets + common.degenerate).toBe(400 * (BLOCK_SIZE / 2));
  });

  it('attributes most returns to the chosen trail', () => {
    const d = decomposeBoomerang(0x0b, 0x08, 0x50, 3, 2, weak, 1200, 2718);
    expect(d.onTrail / d.quartets).toBeCloseTo(0.5, 2);
    expect(d.onTrailReturned / d.returned).toBeGreaterThan(0.8);
  });

  it('the two backward pairs are not independent: q^2 overstates the on-trail return', () => {
    // Distinct from the switch: even with a free switch, requiring BOTH backward
    // pairs to follow the same differential is not q * q on this cipher.
    const d = decomposeBoomerang(0x0b, 0x08, 0x50, 3, 2, weak, 1200, 2718);
    const onTrailRate = d.onTrailReturned / d.onTrail;
    expect(onTrailRate).toBeLessThan(0.375 * 0.375);
    expect(onTrailRate).toBeGreaterThan(0.01);
  });

  it('per-key rates vary widely: one run is not the rate', () => {
    const cipher = runBoomerang(0x0b, 0x50, 3, weak, 800, 606);
    const lo = cipher.perKeySorted[0];
    const hi = cipher.perKeySorted[cipher.perKeySorted.length - 1];
    expect(lo).toBe(0);
    expect(hi).toBeGreaterThan(cipher.rate * 1.5);
  });
});

describe('Act 5: the switch, measured over all 256 middle states', () => {
  const cases: [string, number, number, number, number][] = [
    // name, beta, gamma, expected measured rate, expected trail-based rate
    ['ladder / S-box switch', 0x08, 0x10, 1, 0],
    ['non-trivial BCT', 0xbf, 0x51, 0.390625, 0.000244140625],
    ['control, DDT = BCT', 0x02, 0x05, 0.375, 0.140625],
    ['incompatible', 0x08, 0x51, 0, 0],
  ];

  it.each(cases)('%s: measured equals the BCT exactly', (_n, beta, gamma, expectedMeasured, expectedTrail) => {
    const m = measureSwitch(beta, gamma, weak, W.ddt, W.bct);
    expect(m.states).toBe(BLOCK_SIZE);
    expect(m.measured).toBe(expectedMeasured);
    expect(m.bctPrediction).toBe(expectedMeasured);
    expect(m.trailPrediction).toBe(expectedTrail);
    expect(m.matchesBct).toBe(true);
  });

  it('the trail reading is wrong for three of the four cases', () => {
    const wrong = cases.filter(([, beta, gamma]) => !measureSwitch(beta, gamma, weak, W.ddt, W.bct).matchesTrail);
    expect(wrong).toHaveLength(3);
  });

  it('measured equals the BCT for EVERY switch, not just the chosen cases', () => {
    // The BCT is not being fitted to four examples: it is the definition of the
    // quantity measured, for all 65025 nonzero (beta, gamma) pairs.
    for (let beta = 1; beta < BLOCK_SIZE; beta++) {
      for (let gamma = 1; gamma < BLOCK_SIZE; gamma++) {
        const m = measureSwitch(beta, gamma, weak, W.ddt, W.bct);
        expect(m.measured).toBe(m.bctPrediction);
      }
    }
  }, 60_000);

  it('and for the PRESENT S-box', () => {
    const strong = getSbox('strong');
    const T = tablesFor(strong);
    for (let beta = 1; beta < BLOCK_SIZE; beta += 3) {
      for (let gamma = 1; gamma < BLOCK_SIZE; gamma += 3) {
        const m = measureSwitch(beta, gamma, strong, T.ddt, T.bct);
        expect(m.measured).toBe(m.bctPrediction);
      }
    }
  });

  it('the trail reading never exceeds the measurement: BCT >= DDT has a consequence', () => {
    for (let beta = 1; beta < BLOCK_SIZE; beta += 7) {
      for (let gamma = 1; gamma < BLOCK_SIZE; gamma += 7) {
        const m = measureSwitch(beta, gamma, weak, W.ddt, W.bct);
        expect(m.trailPrediction).toBeLessThanOrEqual(m.measured + 1e-15);
      }
    }
  });
});

describe('findQuartet: the walk replays a real quartet', () => {
  it('finds a returning quartet on the ladder case and every value checks out', () => {
    const w = findQuartetAcrossKeys(0x0b, 0x08, 0x10, 0x50, 3, 2, weak, 0x0000).walk;
    expect(w.found).toBe(true);
    expect((w.p1 ^ w.p2) & 0xff).toBe(0x0b);
    expect((w.x1 ^ w.x2) & 0xff).toBe(0x08);
    expect((w.c3 ^ w.c1) & 0xff).toBe(0x50);
    expect((w.c4 ^ w.c2) & 0xff).toBe(0x50);
    expect((w.x3 ^ w.x4) & 0xff).toBe(0x08);
    expect((w.p3 ^ w.p4) & 0xff).toBe(0x0b);
    expect(w.switchClosed).toBe(true);
    expect(w.returned).toBe(true);
  });

  it('the walk is a real quartet of four DISTINCT plaintexts', () => {
    const w = findQuartetAcrossKeys(0x0b, 0x08, 0x10, 0x50, 3, 2, weak, 0x0000).walk;
    expect(new Set([w.p1, w.p2, w.p3, w.p4]).size).toBe(4);
    expect(new Set([w.c1, w.c2, w.c3, w.c4]).size).toBe(4);
  });

  it('finds no trail-following quartet for an incompatible switch, for 4096 keys', () => {
    // BCT = 0 means the round trip closes for no middle state at all, so no
    // quartet can carry gamma back through this switch and come out at beta.
    // Note what is NOT claimed: such a quartet can still RETURN, by some other
    // middle difference or by chance at 1/255. Only the stated trail is barred.
    for (let mk = 0; mk < 4096; mk++) {
      const w = findQuartet(0x0b, 0x08, 0x51, 0x20, 3, 2, generateKey(mk), weak);
      expect(w.followsStatedTrail).toBe(false);
      expect(w.found).toBe(false);
    }
  });

  it('every leg of the stated trail holds in the quartet it does find', () => {
    const w = findQuartetAcrossKeys(0x0b, 0x08, 0x10, 0x50, 3, 2, weak, 0x0000).walk;
    expect(w.followsStatedTrail).toBe(true);
    expect(w.gammaHeld).toBe(true);
    expect(w.gammaPair1).toBe(0x10);
    expect(w.gammaPair2).toBe(0x10);
  });


  it('a trail probability is not a promise about one key', () => {
    // 6144 of the 65536 keys carry a trail-following quartet on the ladder case.
    // Measured, because the honest version of "p = 1/2" is a rate over keys and
    // pairs, not a guarantee for the key in front of you.
    let withQuartet = 0;
    for (let mk = 0; mk < 4096; mk++) {
      if (findQuartet(0x0b, 0x08, 0x10, 0x50, 3, 2, generateKey(mk), weak).found) withQuartet++;
    }
    expect(withQuartet).toBeGreaterThan(0);
    expect(withQuartet).toBeLessThan(4096);
  });

  it('reports the key it used and how many it tried', () => {
    const s = findQuartetAcrossKeys(0x0b, 0x08, 0x10, 0x50, 3, 2, weak, 0x0001);
    expect(s.walk.found).toBe(true);
    expect(s.keysTried).toBeGreaterThan(0);
    expect(s.masterKey & 0xffff).toBe(s.masterKey);
  });

  it('reports failure honestly when no key in the whole space realises the trail', () => {
    // The control case: beta=0x02 gamma=0x05 has a switch that closes 96 of 256
    // times, yet the four legs of the trail cannot all hold at once within the
    // 128 pairs a codebook offers, for any of the 65536 keys. The page says so
    // instead of showing a quartet that only looks like the trail.
    const s = findQuartetAcrossKeys(0xb0, 0x02, 0x05, 0xd0, 3, 2, weak, 0x0000);
    expect(s.walk.found).toBe(false);
    expect(s.exhaustedKeySpace).toBe(true);
    expect(s.keysTried).toBe(MASTER_KEY_SPACE);
  }, 120_000);

  it('refuses a zero difference', () => {
    expect(findQuartet(0, 0x08, 0x10, 0x50, 3, 2, generateKey(1), weak).found).toBe(false);
    expect(findQuartet(0x0b, 0x08, 0x10, 0, 3, 2, generateKey(1), weak).found).toBe(false);
  });
});

describe('wilsonInterval', () => {
  it('brackets the observed rate', () => {
    const [lo, hi] = wilsonInterval(50, 1000);
    expect(lo).toBeLessThan(0.05);
    expect(hi).toBeGreaterThan(0.05);
  });

  it('gives a usable upper bound at zero successes, where a normal interval collapses', () => {
    const [lo, hi] = wilsonInterval(0, 10_000);
    expect(lo).toBe(0);
    expect(hi).toBeGreaterThan(0);
    expect(hi).toBeLessThan(0.001);
  });

  it('narrows as the sample grows', () => {
    const small = wilsonInterval(10, 100);
    const large = wilsonInterval(1000, 10_000);
    expect(large[1] - large[0]).toBeLessThan(small[1] - small[0]);
  });
});
