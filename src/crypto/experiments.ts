/**
 * The experiments. Pure functions over counts: given parameters they return
 * numbers, touching no DOM and holding no state, so the same code runs in the
 * page, in the Worker, and in the unit tests. Nothing here is simulated — every
 * count comes from real encryptions and decryptions of the real cipher.
 *
 * Every result carries its own sample size, because a rate without one is not a
 * measurement (invariant I2).
 */

import {
  BLOCK_SIZE,
  decrypt,
  encrypt,
  encryptCodebook,
  encryptToRoundInput,
  generateKey,
  invertCodebook,
  lastRoundInputDiff,
  roundKey,
  sievedSubkeyIndex,
  type SpnKey,
} from './spn.ts';
import { substitute, substituteInverse, type Sbox } from './sbox.ts';
import { permute } from './permutation.ts';
import { forwardSet, reachableCiphertextDiffs } from './trails.ts';
import { layerProbability, switchProbabilityBCT, switchProbabilityTrail, type Table } from './tables.ts';

export const MASTER_KEY_SPACE = 1 << 16;
/** The rate a random 8-bit permutation returns a boomerang quartet at: 1/(2^n - 1). */
export const RANDOM_RETURN_RATE = 1 / (BLOCK_SIZE - 1);

/**
 * A deterministic 32-bit LCG, used ONLY to choose which master keys an
 * experiment samples. It never generates key material: a key the page actually
 * uses comes from `randomKey()` and the platform CSPRNG. A seeded sampler is
 * what makes a run reproducible, which is what makes a claim checkable.
 */
export function makeKeySampler(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return (s >>> 8) & 0xffff;
  };
}

/** Every master key exactly once, or `count` sampled ones. */
function keyStream(count: number, seed: number): () => number {
  if (count >= MASTER_KEY_SPACE) {
    let i = -1;
    return () => {
      i += 1;
      return i;
    };
  }
  return makeKeySampler(seed);
}

/** A Wilson score interval, which behaves at zero successes where the normal approximation does not. */
export function wilsonInterval(successes: number, trials: number, z = 1.959964): [number, number] {
  if (trials === 0) return [0, 1];
  const p = successes / trials;
  const denom = 1 + (z * z) / trials;
  const centre = p + (z * z) / (2 * trials);
  const spread = z * Math.sqrt((p * (1 - p)) / trials + (z * z) / (4 * trials * trials));
  return [Math.max(0, (centre - spread) / denom), Math.min(1, (centre + spread) / denom)];
}

// ── Act 1: does one trail survive the rounds? ───────────────────────────────

export interface DecayPoint {
  readonly rounds: number;
  readonly alpha: number;
  readonly delta: number;
  /** Product of DDT entries along the single best trail. */
  readonly trailPrediction: number;
  /** Sum over every trail with the same endpoints: the differential's real probability. */
  readonly differentialPrediction: number;
  readonly measured: number;
  readonly hits: number;
  readonly pairs: number;
  readonly keysUsed: number;
  /** Expected right pairs if an attacker buys the entire 256-plaintext codebook. */
  readonly rightPairsInCodebook: number;
}

/**
 * Measure one differential's probability by encrypting real pairs.
 *
 * For each sampled key, every one of the 128 unordered pairs with difference
 * `alpha` is encrypted and its output difference compared with `delta`. The
 * denominator is pairs, not keys, and it is reported.
 */
export function measureDifferential(
  alpha: number,
  delta: number,
  rounds: number,
  sbox: Sbox,
  keyCount: number,
  seed: number
): { hits: number; pairs: number; keysUsed: number } {
  const nextKey = keyStream(keyCount, seed);
  const keys = Math.min(keyCount, MASTER_KEY_SPACE);
  let hits = 0;
  let pairs = 0;
  for (let k = 0; k < keys; k++) {
    const key = generateKey(nextKey());
    const book = encryptCodebook(key, sbox, rounds);
    for (let p = 0; p < BLOCK_SIZE; p++) {
      const q = p ^ alpha;
      if (q < p) continue;
      pairs++;
      if ((book[p] ^ book[q]) === delta) hits++;
    }
  }
  return { hits, pairs, keysUsed: keys };
}

// ── Act 2: a difference that never happens ─────────────────────────────────

export interface ImpossibilityResult {
  readonly alpha: number;
  readonly delta: number;
  readonly rounds: number;
  /** Nonzero ciphertext differences the structural argument rules out. */
  readonly impossibleDiffs: readonly number[];
  /** True when `delta` is one of them. */
  readonly predictedImpossible: boolean;
  /** How often `delta` actually occurred. Must be 0 when predictedImpossible. */
  readonly occurrences: number;
  readonly pairs: number;
  readonly keysUsed: number;
  readonly exhaustiveOverKeys: boolean;
  /** Ciphertext differences seen at least once, for the "prediction is tight" check. */
  readonly observedDistinct: number;
  readonly predictedReachable: number;
}

/**
 * Count occurrences of `alpha -> delta` over `rounds` rounds, and compare the
 * set of differences that actually occurred against the set the structural
 * argument predicts.
 *
 * Both halves matter. Zero occurrences of a predicted-impossible difference is
 * the impossibility holding. The reverse check — that every predicted-reachable
 * difference really does occur — is what stops the prediction being a vacuous
 * over-estimate: a "support" that claimed everything was reachable would also
 * never be contradicted.
 */
export function measureImpossibility(
  alpha: number,
  delta: number,
  rounds: number,
  sbox: Sbox,
  ddt: Table,
  keyCount: number,
  seed: number
): ImpossibilityResult {
  const reachable = reachableCiphertextDiffs(ddt, alpha, rounds);
  const impossibleDiffs: number[] = [];
  for (let d = 1; d < BLOCK_SIZE; d++) if (!reachable.has(d)) impossibleDiffs.push(d);

  const nextKey = keyStream(keyCount, seed);
  const keys = Math.min(keyCount, MASTER_KEY_SPACE);
  const seen = new Uint8Array(BLOCK_SIZE);
  let occurrences = 0;
  let pairs = 0;
  for (let k = 0; k < keys; k++) {
    const key = generateKey(nextKey());
    const book = encryptCodebook(key, sbox, rounds);
    for (let p = 0; p < BLOCK_SIZE; p++) {
      const q = p ^ alpha;
      if (q < p) continue;
      pairs++;
      const d = book[p] ^ book[q];
      seen[d] = 1;
      if (d === delta) occurrences++;
    }
  }
  let observedDistinct = 0;
  for (let d = 1; d < BLOCK_SIZE; d++) if (seen[d]) observedDistinct++;
  return {
    alpha,
    delta,
    rounds,
    impossibleDiffs,
    predictedImpossible: impossibleDiffs.includes(delta),
    occurrences,
    pairs,
    keysUsed: keys,
    exhaustiveOverKeys: keys >= MASTER_KEY_SPACE,
    observedDistinct,
    predictedReachable: reachable.size,
  };
}

// ── Act 3: the impossible-differential key sieve ───────────────────────────

export interface SieveResult {
  readonly rounds: number;
  readonly alphas: readonly number[];
  /** Candidates still standing after each pair, in order. */
  readonly curve: readonly number[];
  readonly survivors: readonly number[];
  readonly trueSubkey: number;
  readonly trueSubkeyIndex: number;
  readonly trueSubkeySurvived: boolean;
  readonly pairsUsed: number;
  readonly pairsAvailable: number;
  /** Nonzero differences at the last round's S-box input that rule a guess out. */
  readonly sieveSizes: readonly { alpha: number; impossible: number }[];
}

/**
 * Sieve the final mixing key K_R with an impossible differential over the first
 * R-1 rounds.
 *
 * For each pair, and each of the 256 guesses for K_R, peel the last round off
 * both ciphertexts and look at the difference that enters that round's S-box.
 * Only K_R is needed — K_(R-1) cancels in the XOR, see `lastRoundInputDiff`.
 * If that difference is one the first R-1 rounds can never produce, the guess
 * is wrong and is struck out. Nothing is scored or ranked: a candidate is
 * eliminated or it is not.
 *
 * The true key is never eliminated because it reproduces the real difference,
 * which is achievable by definition. That is invariant I5, and it is asserted
 * rather than assumed.
 */
export function runSieve(
  alphas: readonly number[],
  rounds: number,
  sbox: Sbox,
  ddt: Table,
  key: SpnKey,
  seed: number
): SieveResult {
  const allowed = new Map<number, Uint8Array>();
  const sieveSizes: { alpha: number; impossible: number }[] = [];
  for (const a of alphas) {
    const set = forwardSet(ddt, a, rounds - 1);
    const mask = new Uint8Array(BLOCK_SIZE);
    for (const x of set) mask[x] = 1;
    allowed.set(a, mask);
    let impossible = 0;
    for (let d = 1; d < BLOCK_SIZE; d++) if (!mask[d]) impossible++;
    sieveSizes.push({ alpha: a, impossible });
  }

  const jobs: [number, number][] = [];
  for (const a of alphas) {
    for (let p = 0; p < BLOCK_SIZE; p++) if ((p ^ a) > p) jobs.push([p, a]);
  }
  // Shuffle so the elimination curve is not an artefact of plaintext order.
  let s = seed >>> 0 || 1;
  for (let i = jobs.length - 1; i > 0; i--) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    const j = (s >>> 8) % (i + 1);
    const t = jobs[i];
    jobs[i] = jobs[j];
    jobs[j] = t;
  }

  const alive = new Uint8Array(BLOCK_SIZE).fill(1);
  let aliveCount = BLOCK_SIZE;
  const curve: number[] = [];
  let used = 0;
  for (const [p1, a] of jobs) {
    const mask = allowed.get(a)!;
    const p2 = p1 ^ a;
    const c1 = encrypt(p1, key, sbox, rounds);
    const c2 = encrypt(p2, key, sbox, rounds);
    used++;
    for (let guess = 0; guess < BLOCK_SIZE; guess++) {
      if (!alive[guess]) continue;
      if (!mask[lastRoundInputDiff(c1, c2, guess, sbox)]) {
        alive[guess] = 0;
        aliveCount--;
      }
    }
    curve.push(aliveCount);
    if (aliveCount <= 1) break;
  }
  const survivors: number[] = [];
  for (let g = 0; g < BLOCK_SIZE; g++) if (alive[g]) survivors.push(g);
  const idx = sievedSubkeyIndex(rounds);
  const trueSubkey = roundKey(key, rounds);
  return {
    rounds,
    alphas: [...alphas],
    curve,
    survivors,
    trueSubkey,
    trueSubkeyIndex: idx,
    trueSubkeySurvived: alive[trueSubkey] === 1,
    pairsUsed: used,
    pairsAvailable: jobs.length,
    sieveSizes,
  };
}

// ── Act 4: the boomerang ───────────────────────────────────────────────────

export interface BoomerangResult {
  readonly alpha: number;
  readonly delta: number;
  readonly rounds: number;
  readonly returned: number;
  readonly quartets: number;
  readonly degenerate: number;
  readonly keysUsed: number;
  readonly rate: number;
  readonly ci: readonly [number, number];
  /** Per-key return rates, sorted, for the spread readout. */
  readonly perKeySorted: readonly number[];
}

/**
 * Run the boomerang quartet procedure against the real cipher.
 *
 *   P2 = P1 XOR alpha,  C1 = E(P1),  C2 = E(P2)
 *   C3 = C1 XOR delta,  C4 = C2 XOR delta
 *   P3 = D(C3),         P4 = D(C4)
 *   the quartet RETURNS when P3 XOR P4 = alpha
 *
 * ATTACK MODEL, stated because it is strong: this needs a chosen-plaintext
 * oracle for the first pair AND an adaptive chosen-ciphertext oracle for the
 * second, since C3 and C4 are chosen only after C1 and C2 come back. Rectangle
 * attacks exist precisely to avoid the decryption half.
 *
 * DEGENERATE QUARTETS ARE EXCLUDED AND COUNTED. When delta happens to equal
 * C1 XOR C2, then C3 = C2 and C4 = C1, so P3 and P4 are P2 and P1 and the test
 * passes trivially — the "new" pair is the old one swapped, carrying no
 * information. On a 64-bit block that is negligible; on an 8-bit block it
 * happens at roughly the rate of the (alpha, delta) differential itself, which
 * for a good differential is percent-scale and would dominate the result.
 */
export function runBoomerang(
  alpha: number,
  delta: number,
  rounds: number,
  sbox: Sbox,
  keyCount: number,
  seed: number
): BoomerangResult {
  const nextKey = keyStream(keyCount, seed);
  const keys = Math.min(keyCount, MASTER_KEY_SPACE);
  let returned = 0;
  let quartets = 0;
  let degenerate = 0;
  const perKey: number[] = [];
  for (let k = 0; k < keys; k++) {
    const key = generateKey(nextKey());
    const book = encryptCodebook(key, sbox, rounds);
    const inverse = invertCodebook(book);
    let r = 0;
    let n = 0;
    for (let p1 = 0; p1 < BLOCK_SIZE; p1++) {
      const p2 = p1 ^ alpha;
      if (p2 < p1) continue;
      const c1 = book[p1];
      const c2 = book[p2];
      if ((c1 ^ c2) === delta) {
        degenerate++;
        continue;
      }
      n++;
      if ((inverse[c1 ^ delta] ^ inverse[c2 ^ delta]) === alpha) r++;
    }
    quartets += n;
    returned += r;
    perKey.push(n > 0 ? r / n : 0);
  }
  perKey.sort((a, b) => a - b);
  return {
    alpha,
    delta,
    rounds,
    returned,
    quartets,
    degenerate,
    keysUsed: keys,
    rate: quartets > 0 ? returned / quartets : 0,
    ci: wilsonInterval(returned, quartets),
    perKeySorted: perKey,
  };
}

/**
 * The same procedure against random 8-bit permutations: the null a boomerang
 * distinguisher has to beat. Measured rather than quoted, because the quartet
 * procedure's exclusions shift it slightly off a textbook 1/(2^n - 1).
 */
export function runBoomerangNull(
  alpha: number,
  delta: number,
  permutationCount: number,
  seed: number
): BoomerangResult {
  let s = seed >>> 0 || 1;
  const rnd = (): number => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s >>> 8;
  };
  let returned = 0;
  let quartets = 0;
  let degenerate = 0;
  const perKey: number[] = [];
  for (let k = 0; k < permutationCount; k++) {
    const book = new Uint8Array(BLOCK_SIZE);
    for (let i = 0; i < BLOCK_SIZE; i++) book[i] = i;
    for (let i = BLOCK_SIZE - 1; i > 0; i--) {
      const j = rnd() % (i + 1);
      const t = book[i];
      book[i] = book[j];
      book[j] = t;
    }
    const inverse = invertCodebook(book);
    let r = 0;
    let n = 0;
    for (let p1 = 0; p1 < BLOCK_SIZE; p1++) {
      const p2 = p1 ^ alpha;
      if (p2 < p1) continue;
      const c1 = book[p1];
      const c2 = book[p2];
      if ((c1 ^ c2) === delta) {
        degenerate++;
        continue;
      }
      n++;
      if ((inverse[c1 ^ delta] ^ inverse[c2 ^ delta]) === alpha) r++;
    }
    quartets += n;
    returned += r;
    perKey.push(n > 0 ? r / n : 0);
  }
  perKey.sort((a, b) => a - b);
  return {
    alpha,
    delta,
    rounds: 0,
    returned,
    quartets,
    degenerate,
    keysUsed: permutationCount,
    rate: quartets > 0 ? returned / quartets : 0,
    ci: wilsonInterval(returned, quartets),
    perKeySorted: perKey,
  };
}

/**
 * How much of a measured return rate follows the trail that was chosen.
 *
 * Reads the real middle difference, which needs the key — so this is an
 * instrument, not an attack, and the page labels it that way. It is the only
 * honest way to say whether a measured rate belongs to the stated trail or to
 * the hundreds of other paths sharing the same (alpha, delta).
 */
export function decomposeBoomerang(
  alpha: number,
  beta: number,
  delta: number,
  rounds: number,
  switchRound: number,
  sbox: Sbox,
  keyCount: number,
  seed: number
): {
  quartets: number;
  returned: number;
  onTrail: number;
  onTrailReturned: number;
  keysUsed: number;
} {
  const nextKey = keyStream(keyCount, seed);
  const keys = Math.min(keyCount, MASTER_KEY_SPACE);
  let quartets = 0;
  let returned = 0;
  let onTrail = 0;
  let onTrailReturned = 0;
  for (let k = 0; k < keys; k++) {
    const key = generateKey(nextKey());
    const book = encryptCodebook(key, sbox, rounds);
    const inverse = invertCodebook(book);
    for (let p1 = 0; p1 < BLOCK_SIZE; p1++) {
      const p2 = p1 ^ alpha;
      if (p2 < p1) continue;
      const c1 = book[p1];
      const c2 = book[p2];
      if ((c1 ^ c2) === delta) continue;
      quartets++;
      const x1 = encryptToRoundInput(p1, key, sbox, switchRound - 1);
      const x2 = encryptToRoundInput(p2, key, sbox, switchRound - 1);
      const hit = ((x1 ^ x2) & 0xff) === beta;
      const back = (inverse[c1 ^ delta] ^ inverse[c2 ^ delta]) === alpha;
      if (back) returned++;
      if (hit) {
        onTrail++;
        if (back) onTrailReturned++;
      }
    }
  }
  return { quartets, returned, onTrail, onTrailReturned, keysUsed: keys };
}

// ── Act 5: the switch, on its own ──────────────────────────────────────────

export interface SwitchMeasurement {
  readonly beta: number;
  readonly gamma: number;
  /** Middle states whose round trip closes. */
  readonly closed: number;
  /** Always 256: the whole middle-state space, so this is a proof, not a sample. */
  readonly states: number;
  readonly measured: number;
  readonly bctPrediction: number;
  readonly trailPrediction: number;
  readonly ddtHigh: number;
  readonly ddtLow: number;
  readonly bctHigh: number;
  readonly bctLow: number;
  /** Which prediction the measurement matches, to the bit. */
  readonly matchesBct: boolean;
  readonly matchesTrail: boolean;
}

/**
 * Measure the boomerang switch across one S-box LAYER by exhausting all 256
 * middle states. No sampling, no confidence interval: every state is tried, so
 * the result is exact.
 *
 * For each middle state X, with X' = X XOR beta:
 *     Y  = S(X),   Y' = S(X')            forward through the switch
 *     Z  = Y XOR gamma,  Z' = Y' XOR gamma    the boomerang's shift
 *     W  = S^-1(Z),  W' = S^-1(Z')       back through the switch
 *     the switch RETURNS when W XOR W' = beta
 *
 * That is the BCT's definition applied to both nibbles at once, which is why
 * the measurement can only agree with the BCT — and the point of running it is
 * that the DDT-based reading of the same switch disagrees.
 */
export function measureSwitch(
  beta: number,
  gamma: number,
  sbox: Sbox,
  ddt: Table,
  bct: Table
): SwitchMeasurement {
  let closed = 0;
  for (let x = 0; x < BLOCK_SIZE; x++) {
    const y = substitute(x, sbox);
    const yp = substitute(x ^ beta, sbox);
    const w = substituteInverse((y ^ gamma) & 0xff, sbox);
    const wp = substituteInverse((yp ^ gamma) & 0xff, sbox);
    if (((w ^ wp) & 0xff) === (beta & 0xff)) closed++;
  }
  const measured = closed / BLOCK_SIZE;
  const bctPrediction = switchProbabilityBCT(bct, beta, gamma);
  const trailPrediction = switchProbabilityTrail(ddt, beta, gamma);
  const bh = (beta >> 4) & 0xf;
  const bl = beta & 0xf;
  const gh = (gamma >> 4) & 0xf;
  const gl = gamma & 0xf;
  return {
    beta,
    gamma,
    closed,
    states: BLOCK_SIZE,
    measured,
    bctPrediction,
    trailPrediction,
    ddtHigh: ddt[bh][gh],
    ddtLow: ddt[bl][gl],
    bctHigh: bct[bh][gh],
    bctLow: bct[bl][gl],
    matchesBct: Math.abs(measured - bctPrediction) < 1e-12,
    matchesTrail: Math.abs(measured - trailPrediction) < 1e-12,
  };
}

/**
 * One concrete quartet at the switch, stage by stage, for the walk.
 *
 * Every value is produced by the real cipher under a real key. The walk finds a
 * plaintext pair that actually reaches `beta` at the switch and whose quartet
 * actually returns; the animation replays that quartet, so nothing on screen is
 * a drawing of what should happen.
 */
export interface QuartetWalk {
  readonly found: boolean;
  readonly alpha: number;
  readonly beta: number;
  readonly gamma: number;
  readonly delta: number;
  readonly p1: number;
  readonly p2: number;
  readonly p3: number;
  readonly p4: number;
  readonly x1: number;
  readonly x2: number;
  readonly x3: number;
  readonly x4: number;
  readonly y1: number;
  readonly y2: number;
  readonly y3: number;
  readonly y4: number;
  readonly c1: number;
  readonly c2: number;
  readonly c3: number;
  readonly c4: number;
  /** Difference at the switch input for the forward pair; equals beta when found. */
  readonly forwardMid: number;
  /** Difference at the switch input for the backward pair; equals beta when the switch closed. */
  readonly backwardMid: number;
  /** Difference at the switch OUTPUT for the two shifted pairs: gamma when the E1 half held. */
  readonly gammaPair1: number;
  readonly gammaPair2: number;
  /** Both shifted pairs really carried gamma back to the switch. */
  readonly gammaHeld: boolean;
  readonly switchClosed: boolean;
  readonly returned: boolean;
  /** Every leg of the stated trail held: this quartet IS the trail, not a lookalike. */
  readonly followsStatedTrail: boolean;
}

export function findQuartet(
  alpha: number,
  beta: number,
  gamma: number,
  delta: number,
  rounds: number,
  switchRound: number,
  key: SpnKey,
  sbox: Sbox
): QuartetWalk {
  const empty: QuartetWalk = {
    found: false,
    alpha,
    beta,
    gamma,
    delta,
    p1: 0,
    p2: 0,
    p3: 0,
    p4: 0,
    x1: 0,
    x2: 0,
    x3: 0,
    x4: 0,
    y1: 0,
    y2: 0,
    y3: 0,
    y4: 0,
    c1: 0,
    c2: 0,
    c3: 0,
    c4: 0,
    forwardMid: 0,
    backwardMid: 0,
    gammaPair1: 0,
    gammaPair2: 0,
    gammaHeld: false,
    switchClosed: false,
    returned: false,
    followsStatedTrail: false,
  };
  if (alpha === 0 || delta === 0) return empty;
  for (let p1 = 0; p1 < BLOCK_SIZE; p1++) {
    const p2 = p1 ^ alpha;
    if (p2 < p1) continue;
    const x1 = encryptToRoundInput(p1, key, sbox, switchRound - 1);
    const x2 = encryptToRoundInput(p2, key, sbox, switchRound - 1);
    if (((x1 ^ x2) & 0xff) !== beta) continue;
    const c1 = encrypt(p1, key, sbox, rounds);
    const c2 = encrypt(p2, key, sbox, rounds);
    if ((c1 ^ c2) === delta) continue;
    const c3 = (c1 ^ delta) & 0xff;
    const c4 = (c2 ^ delta) & 0xff;
    const p3 = decrypt(c3, key, sbox, rounds);
    const p4 = decrypt(c4, key, sbox, rounds);
    const x3 = encryptToRoundInput(p3, key, sbox, switchRound - 1);
    const x4 = encryptToRoundInput(p4, key, sbox, switchRound - 1);
    const y1 = substitute(x1, sbox);
    const y2 = substitute(x2, sbox);
    const y3 = substitute(x3, sbox);
    const y4 = substitute(x4, sbox);
    const gammaPair1 = (y3 ^ y1) & 0xff;
    const gammaPair2 = (y4 ^ y2) & 0xff;
    const gammaHeld = gammaPair1 === (gamma & 0xff) && gammaPair2 === (gamma & 0xff);
    const returned = ((p3 ^ p4) & 0xff) === alpha;
    const switchClosed = ((x3 ^ x4) & 0xff) === (beta & 0xff);
    // Every leg of the stated trail, not merely a quartet that happened to come
    // back. A quartet can return by a different route entirely - through another
    // middle difference, or by chance at 1/255 - and showing one of those as the
    // trail would teach the wrong thing.
    if (!(returned && gammaHeld && switchClosed)) continue;
    return {
      found: true,
      alpha,
      beta,
      gamma,
      delta,
      p1,
      p2,
      p3,
      p4,
      x1,
      x2,
      x3,
      x4,
      y1,
      y2,
      y3,
      y4,
      c1,
      c2,
      c3,
      c4,
      forwardMid: (x1 ^ x2) & 0xff,
      backwardMid: (x3 ^ x4) & 0xff,
      gammaPair1,
      gammaPair2,
      gammaHeld,
      switchClosed,
      returned,
      followsStatedTrail: true,
    };
  }
  return empty;
}

/**
 * Scan master keys for one that actually realises the stated trail in a quartet.
 *
 * Needed because a trail's probability is not a promise about a particular key.
 * On the ladder case 6144 of the 65536 keys carry a trail-following quartet
 * within the 128 pairs the codebook offers; on the amplified case 864 do; and on
 * some cases NONE do, because the four legs of the trail impose four conditions
 * at once on a 256-state middle and the conjunction can be empty for every key.
 * The walk reports which key it used and how many it tried, so the reader sees
 * the search rather than a lucky default presented as typical.
 */
export interface QuartetSearch {
  readonly walk: QuartetWalk;
  readonly masterKey: number;
  readonly keysTried: number;
  readonly exhaustedKeySpace: boolean;
}

export function findQuartetAcrossKeys(
  alpha: number,
  beta: number,
  gamma: number,
  delta: number,
  rounds: number,
  switchRound: number,
  sbox: Sbox,
  startKey: number,
  limit = MASTER_KEY_SPACE
): QuartetSearch {
  const total = Math.min(limit, MASTER_KEY_SPACE);
  for (let i = 0; i < total; i++) {
    const mk = (startKey + i) & 0xffff;
    const walk = findQuartet(alpha, beta, gamma, delta, rounds, switchRound, generateKey(mk), sbox);
    if (walk.found) {
      return { walk, masterKey: mk, keysTried: i + 1, exhaustedKeySpace: false };
    }
  }
  return {
    walk: findQuartet(alpha, beta, gamma, delta, rounds, switchRound, generateKey(startKey), sbox),
    masterKey: startKey & 0xffff,
    keysTried: total,
    exhaustedKeySpace: total >= MASTER_KEY_SPACE,
  };
}

/**
 * The trail probability across one half, as a product of DDT entries.
 * `layers === 0` means that half is empty — the switch sits at the very first
 * or very last S-box layer — in which case the half is the identity on
 * differences and its probability is exactly 1.
 */
export function halfTrailProbability(
  from: number,
  to: number,
  layers: number,
  tablesByLayer: readonly { trail: readonly Float64Array[] }[]
): number {
  if (layers === 0) return from === to ? 1 : 0;
  return tablesByLayer[layers - 1].trail[from][to];
}

/** The permutation between the switch output and the input of the next S-box layer. */
export function afterSwitch(gamma: number): number {
  return permute(gamma);
}

/** Direct DDT probability of one crossing, re-exported so the UI needs no table math. */
export const crossingProbability = layerProbability;
