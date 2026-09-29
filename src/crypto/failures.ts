/**
 * Every way a run on this page can refuse to produce a result, as exported
 * constants rather than inline strings.
 *
 * Two rules, both enforced by `e2e/claims.spec.ts`:
 *   - the page NAMES the actual cause, never a generic "something went wrong";
 *   - every code below is reachable through the UI and is asserted there.
 *
 * `E_TRUE_KEY_ELIMINATED` is the exception: it is an invariant breach, not an
 * input problem. Invariant I5 says the sieve can never eliminate the true
 * subkey, and the argument is airtight — the true subkey reproduces the real
 * difference, which is by construction achievable. The code exists so that if
 * the argument is ever wrong the page says so loudly instead of quietly
 * reporting a successful attack. It is asserted never to fire.
 */

export const FAILURE_CODES = {
  ALPHA_ZERO: 'E_ALPHA_ZERO',
  DELTA_ZERO: 'E_DELTA_ZERO',
  NO_TRAIL: 'E_NO_TRAIL',
  SWITCH_INCOMPATIBLE: 'E_SWITCH_INCOMPATIBLE',
  NOT_IMPOSSIBLE: 'E_NOT_IMPOSSIBLE',
  SIEVE_AMBIGUOUS: 'E_SIEVE_AMBIGUOUS',
  TRUE_KEY_ELIMINATED: 'E_TRUE_KEY_ELIMINATED',
  INSUFFICIENT_SAMPLES: 'E_INSUFFICIENT_SAMPLES',
  RANGE: 'E_RANGE',
} as const;

export type FailureCode = (typeof FAILURE_CODES)[keyof typeof FAILURE_CODES];

/** What the page prints for each code. One sentence, naming the real cause. */
export const FAILURE_TEXT: Readonly<Record<FailureCode, string>> = {
  E_ALPHA_ZERO:
    'Input difference is 00. A pair with no difference is one plaintext encrypted twice, so there is nothing to track.',
  E_DELTA_ZERO:
    'Ciphertext difference is 00. The shifted pair would be the original pair, so the quartet collapses before it starts.',
  E_NO_TRAIL:
    'No trail joins these two differences across this half: some crossing on the way has a DDT entry of zero, so its probability is exactly zero.',
  E_SWITCH_INCOMPATIBLE:
    'This switch has a BCT entry of zero, so the round trip closes for no middle state at all. The boomerang can never return through it.',
  E_NOT_IMPOSSIBLE:
    'This differential occurred, so it is NOT impossible. The impossibility claim is withdrawn and the occurrence count below is the evidence.',
  E_SIEVE_AMBIGUOUS:
    'The sieve ran out of pairs with more than one candidate standing. An 8-bit block holds only 128 pairs per input difference, so the data ran out, not the method.',
  E_TRUE_KEY_ELIMINATED:
    'INVARIANT BREACH: the sieve eliminated the true subkey. That must never happen; treat every result on this page as suspect.',
  E_INSUFFICIENT_SAMPLES:
    'The confidence interval still overlaps the random-permutation rate, so this run does not distinguish the cipher from chance. Raise the key count.',
  E_RANGE: 'A control is outside the range this cipher supports, so the run was not started.',
};
