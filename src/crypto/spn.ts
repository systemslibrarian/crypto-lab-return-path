/**
 * The toy SPN under attack — 8-bit block, 16-bit key.
 *
 * PROVENANCE (verification gate V0). This is the cipher of
 * `crypto-lab-biham-lens` and `crypto-lab-matsui-line`, reused rather than
 * reinvented so that all three labs attack the same target. It is NOT the
 * 16-bit SPN of Heys' tutorial; the S-box is Heys', the block is 8 bits. The
 * agreement is checked, not assumed: `spn.test.ts` reproduces the four-round
 * encryption of biham-lens for every plaintext under a range of keys, and
 * asserts the round-key extension below leaves that cipher untouched.
 *
 *     state = plaintext
 *     for r in 0 .. R-1:
 *         state = S(state XOR K_r)          // key mixing, then substitution
 *         if r < R-1: state = P(state)      // no permutation in the last round
 *     ciphertext = state XOR K_R            // final key mixing
 *
 * The permutation is dropped in the last round, as in DES and every textbook
 * SPN: after the final substitution it would be public and invertible, so it
 * adds nothing.
 *
 * ROUND KEYS. The published schedule takes the low byte of the 16-bit master
 * key, rotates the master key left by four bits, and repeats — five times, for
 * four rounds plus the final mixing. Rotating a 16-bit word left by 4 has
 * order 4, so the schedule is PERIODIC WITH PERIOD 4: K_4 = K_0 already in the
 * published five, and continuing the rotation gives K_r = K_(r mod 4) for
 * every r. `roundKey` is exactly that continuation, so it agrees with the
 * published five-element array on r = 0..4 (asserted for all 65536 master keys
 * in the tests) while letting the round count run past four. Act 1 needs
 * that: on this cipher the best differential is still measurably above chance
 * at four rounds, and the decay only becomes the point at five and six.
 *
 * NOT PRODUCTION CRYPTOGRAPHY. An 8-bit block holds 256 plaintexts and a
 * 16-bit key 65536 keys, so the whole cipher fits in a browser tab — which is
 * the point: every claim on this page can be checked by exhaustion instead of
 * asserted.
 */

import { substitute, substituteInverse, type Sbox } from './sbox.ts';
import { permute, permuteInverse } from './permutation.ts';

/** The published cipher. Reduced- and extended-round variants drive the acts. */
export const FULL_ROUNDS = 4;
export const MIN_ROUNDS = 1;
export const MAX_ROUNDS = 6;
/** log2 of the block size in states: 8-bit block. */
export const BLOCK_BITS = 8;
export const BLOCK_SIZE = 1 << BLOCK_BITS;
/** Unordered plaintext pairs sharing one fixed nonzero difference. */
export const PAIRS_PER_CODEBOOK = BLOCK_SIZE / 2;
/** The period of the rotate-left-4 key schedule. */
export const KEY_SCHEDULE_PERIOD = 4;

export interface SpnKey {
  /** 16-bit master key. */
  readonly masterKey: number;
  /** The published five subkeys: one per round of the four-round cipher, plus the final mixing key. */
  readonly subkeys: readonly number[];
}

/**
 * The published key schedule, byte for byte: low byte, rotate the master key
 * left 4, repeat, five times.
 */
export function generateKey(masterKey: number): SpnKey {
  const subkeys: number[] = [];
  let k = masterKey & 0xffff;
  for (let i = 0; i < 5; i++) {
    subkeys.push(k & 0xff);
    k = ((k << 4) | (k >> 12)) & 0xffff;
  }
  return { masterKey: masterKey & 0xffff, subkeys };
}

/**
 * The round key for round r, for any r >= 0.
 *
 * Identical to `key.subkeys[r]` for r = 0..4 because the rotation has order 4;
 * `spn.test.ts` asserts that for every one of the 65536 master keys rather
 * than trusting the argument.
 */
export function roundKey(key: SpnKey, r: number): number {
  return key.subkeys[r & (KEY_SCHEDULE_PERIOD - 1)];
}

/** A fresh key from the platform CSPRNG. Per-session, in memory, never persisted. */
export function randomKey(): SpnKey {
  const buf = new Uint8Array(2);
  crypto.getRandomValues(buf);
  return generateKey((buf[0] << 8) | buf[1]);
}

function assertRounds(rounds: number): void {
  if (!Number.isInteger(rounds) || rounds < MIN_ROUNDS || rounds > MAX_ROUNDS) {
    throw new RangeError(`rounds must be an integer in ${MIN_ROUNDS}..${MAX_ROUNDS}, got ${rounds}`);
  }
}

export function encrypt(plaintext: number, key: SpnKey, sbox: Sbox, rounds = FULL_ROUNDS): number {
  assertRounds(rounds);
  let state = plaintext & 0xff;
  for (let r = 0; r < rounds; r++) {
    state = substitute(state ^ roundKey(key, r), sbox);
    if (r < rounds - 1) state = permute(state);
  }
  return (state ^ roundKey(key, rounds)) & 0xff;
}

export function decrypt(ciphertext: number, key: SpnKey, sbox: Sbox, rounds = FULL_ROUNDS): number {
  assertRounds(rounds);
  let state = (ciphertext ^ roundKey(key, rounds)) & 0xff;
  for (let r = rounds - 1; r >= 0; r--) {
    if (r < rounds - 1) state = permuteInverse(state);
    state = substituteInverse(state, sbox) ^ roundKey(key, r);
  }
  return state & 0xff;
}

/** A full codebook: E(p) for every one of the 256 plaintexts, under one key. */
export function encryptCodebook(key: SpnKey, sbox: Sbox, rounds = FULL_ROUNDS): Uint8Array {
  const out = new Uint8Array(BLOCK_SIZE);
  for (let p = 0; p < BLOCK_SIZE; p++) out[p] = encrypt(p, key, sbox, rounds);
  return out;
}

/** The inverse of a codebook. The cipher is a permutation, so this is total. */
export function invertCodebook(codebook: Uint8Array): Uint8Array {
  const out = new Uint8Array(BLOCK_SIZE);
  for (let p = 0; p < BLOCK_SIZE; p++) out[codebook[p]] = p;
  return out;
}

/**
 * The state entering round `stopBefore`'s S-box — that is, after the key XOR of
 * that round has been applied. Differences do not see the key XOR, so this is
 * the point every trail in this lab is measured at.
 *
 * `stopBefore = 0` returns the plaintext itself.
 */
export function encryptToRoundInput(
  plaintext: number,
  key: SpnKey,
  sbox: Sbox,
  stopBefore: number
): number {
  if (!Number.isInteger(stopBefore) || stopBefore < 0 || stopBefore > MAX_ROUNDS) {
    throw new RangeError(`stopBefore must be an integer in 0..${MAX_ROUNDS}, got ${stopBefore}`);
  }
  let state = plaintext & 0xff;
  for (let r = 0; r < stopBefore; r++) {
    state = permute(substitute(state ^ roundKey(key, r), sbox));
  }
  return state & 0xff;
}

/**
 * The difference entering the last round's S-box, recovered from a ciphertext
 * pair under a guess for the FINAL mixing key K_R alone.
 *
 * This is the whole reason an impossible-differential attack on the last round
 * is cheap: C = S(X XOR K_(R-1)) XOR K_R, so
 *
 *     X = S^-1(C XOR K_R) XOR K_(R-1)
 *
 * and in the XOR of two such values K_(R-1) cancels. One 8-bit guess — K_R —
 * determines the difference at the input of the last round's S-box. K_(R-1)
 * never enters the sieve.
 */
export function lastRoundInputDiff(c1: number, c2: number, guessKR: number, sbox: Sbox): number {
  return (
    (substituteInverse((c1 ^ guessKR) & 0xff, sbox) ^
      substituteInverse((c2 ^ guessKR) & 0xff, sbox)) &
    0xff
  );
}

/** Which subkey the last-round sieve actually recovers, for a given round count. */
export function sievedSubkeyIndex(rounds: number): number {
  return rounds & (KEY_SCHEDULE_PERIOD - 1);
}

export type StageKind = 'input' | 'xor-key' | 'sbox' | 'permute' | 'final-key';

export interface TraceStage {
  readonly kind: StageKind;
  readonly label: string;
  /** 1-based round for round-internal stages; 0 for the plaintext. */
  readonly round: number;
  readonly state: number;
}

/**
 * Every observable state of one encryption, for the quartet walk. Returned for
 * a single value: the walk shows four of these side by side and XORs them on
 * screen, so the difference is computed from the states the reader can see
 * rather than asserted alongside them.
 */
export function traceEncryption(
  plaintext: number,
  key: SpnKey,
  sbox: Sbox,
  rounds = FULL_ROUNDS
): TraceStage[] {
  assertRounds(rounds);
  const stages: TraceStage[] = [];
  let s = plaintext & 0xff;
  stages.push({ kind: 'input', label: 'Plaintext', round: 0, state: s });
  for (let r = 0; r < rounds; r++) {
    s = (s ^ roundKey(key, r)) & 0xff;
    stages.push({ kind: 'xor-key', label: `Round ${r + 1}: XOR K${r + 1}`, round: r + 1, state: s });
    s = substitute(s, sbox);
    stages.push({ kind: 'sbox', label: `Round ${r + 1}: S-box`, round: r + 1, state: s });
    if (r < rounds - 1) {
      s = permute(s);
      stages.push({ kind: 'permute', label: `Round ${r + 1}: permute`, round: r + 1, state: s });
    }
  }
  s = (s ^ roundKey(key, rounds)) & 0xff;
  stages.push({
    kind: 'final-key',
    label: `Final: XOR K${rounds + 1}`,
    round: rounds + 1,
    state: s,
  });
  return stages;
}
