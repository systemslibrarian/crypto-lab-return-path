/**
 * The job boundary between the page and the Worker.
 *
 * Everything below is a plain function from a serialisable request to a
 * serialisable result, so the SAME code runs in the Worker, on the main thread
 * when no Worker is available, and in the unit tests. There is no second
 * implementation to drift.
 */

import { getSbox, type SboxName } from './sbox.ts';
import { tablesFor } from './tables.ts';
import { bestDifferential, roundTables } from './trails.ts';
import { generateKey, PAIRS_PER_CODEBOOK } from './spn.ts';
import {
  decomposeBoomerang,
  findQuartetAcrossKeys,
  measureDifferential,
  measureImpossibility,
  runBoomerang,
  runBoomerangNull,
  runSieve,
  type BoomerangResult,
  type ImpossibilityResult,
  type QuartetSearch,
  type SieveResult,
} from './experiments.ts';

export interface DecayRequest {
  readonly kind: 'decay';
  readonly sbox: SboxName;
  readonly maxRounds: number;
  readonly keyCount: number;
  readonly seed: number;
}

export interface DecayRow {
  readonly rounds: number;
  readonly alpha: number;
  readonly delta: number;
  readonly trailPrediction: number;
  readonly differentialPrediction: number;
  readonly measured: number;
  readonly hits: number;
  readonly pairs: number;
  readonly keysUsed: number;
  readonly rightPairsInCodebook: number;
  readonly measuredRightPairs: number;
}

export interface DecayResult {
  readonly kind: 'decay';
  readonly rows: readonly DecayRow[];
  /** Right pairs a random permutation yields over the whole codebook: 128/255. */
  readonly randomRightPairs: number;
}

export interface ImpossibleRequest {
  readonly kind: 'impossible';
  readonly sbox: SboxName;
  readonly alpha: number;
  readonly delta: number;
  readonly rounds: number;
  readonly keyCount: number;
  readonly seed: number;
}

export interface ImpossibleResult extends ImpossibilityResult {
  readonly kind: 'impossible';
}

export interface SieveRequest {
  readonly kind: 'sieve';
  readonly sbox: SboxName;
  readonly alphas: readonly number[];
  readonly rounds: number;
  readonly masterKey: number;
  readonly seed: number;
}

export interface SieveOutcome extends SieveResult {
  readonly kind: 'sieve';
  readonly masterKey: number;
}

export interface BoomerangRequest {
  readonly kind: 'boomerang';
  readonly sbox: SboxName;
  readonly alpha: number;
  readonly beta: number;
  readonly delta: number;
  readonly rounds: number;
  readonly switchRound: number;
  readonly keyCount: number;
  readonly seed: number;
}

export interface BoomerangOutcome {
  readonly kind: 'boomerang';
  readonly cipher: BoomerangResult;
  readonly nullModel: BoomerangResult;
  readonly decomposition: {
    quartets: number;
    returned: number;
    onTrail: number;
    onTrailReturned: number;
    keysUsed: number;
  };
}

export interface QuartetRequest {
  readonly kind: 'quartet';
  readonly sbox: SboxName;
  readonly alpha: number;
  readonly beta: number;
  readonly gamma: number;
  readonly delta: number;
  readonly rounds: number;
  readonly switchRound: number;
  readonly startKey: number;
  readonly limit: number;
}

export interface QuartetOutcome extends QuartetSearch {
  readonly kind: 'quartet';
}

export type JobRequest =
  | DecayRequest
  | ImpossibleRequest
  | SieveRequest
  | BoomerangRequest
  | QuartetRequest;

export type JobResult =
  | DecayResult
  | ImpossibleResult
  | SieveOutcome
  | BoomerangOutcome
  | QuartetOutcome;

export function runJob(req: JobRequest): JobResult {
  const sbox = getSbox(req.sbox);
  const { ddt } = tablesFor(sbox);
  switch (req.kind) {
    case 'decay': {
      const tables = roundTables(ddt, req.maxRounds);
      const rows: DecayRow[] = [];
      for (let r = 1; r <= req.maxRounds; r++) {
        const best = bestDifferential(tables[r - 1]);
        const m = measureDifferential(best.alpha, best.delta, r, sbox, req.keyCount, req.seed + r);
        const measured = m.pairs > 0 ? m.hits / m.pairs : 0;
        rows.push({
          rounds: r,
          alpha: best.alpha,
          delta: best.delta,
          trailPrediction: best.trailProbability,
          differentialPrediction: best.differentialProbability,
          measured,
          hits: m.hits,
          pairs: m.pairs,
          keysUsed: m.keysUsed,
          rightPairsInCodebook: PAIRS_PER_CODEBOOK * best.differentialProbability,
          measuredRightPairs: PAIRS_PER_CODEBOOK * measured,
        });
      }
      return { kind: 'decay', rows, randomRightPairs: PAIRS_PER_CODEBOOK / 255 };
    }
    case 'impossible': {
      const r = measureImpossibility(
        req.alpha,
        req.delta,
        req.rounds,
        sbox,
        ddt,
        req.keyCount,
        req.seed
      );
      return { kind: 'impossible', ...r };
    }
    case 'sieve': {
      const r = runSieve(req.alphas, req.rounds, sbox, ddt, generateKey(req.masterKey), req.seed);
      return { kind: 'sieve', masterKey: req.masterKey & 0xffff, ...r };
    }
    case 'boomerang': {
      return {
        kind: 'boomerang',
        cipher: runBoomerang(req.alpha, req.delta, req.rounds, sbox, req.keyCount, req.seed),
        nullModel: runBoomerangNull(req.alpha, req.delta, req.keyCount, req.seed ^ 0x5bd1),
        decomposition: decomposeBoomerang(
          req.alpha,
          req.beta,
          req.delta,
          req.rounds,
          req.switchRound,
          sbox,
          req.keyCount,
          req.seed
        ),
      };
    }
    case 'quartet': {
      const r = findQuartetAcrossKeys(
        req.alpha,
        req.beta,
        req.gamma,
        req.delta,
        req.rounds,
        req.switchRound,
        sbox,
        req.startKey,
        req.limit
      );
      return { kind: 'quartet', ...r };
    }
  }
}
