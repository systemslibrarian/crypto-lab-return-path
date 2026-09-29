/**
 * The bit permutation of the toy SPN — the diffusion layer.
 *
 * PROVENANCE (V0): byte for byte the permutation in
 * `crypto-lab-biham-lens/demos/biham-lens/src/crypto/permutation.ts` and
 * `crypto-lab-matsui-line/src/crypto/permutation.ts`.
 *
 * `PERMUTATION[i] = j` means input bit i is written to output position j, with
 * bit 0 the least significant. Bits 0..3 are the low nibble (the low S-box),
 * bits 4..7 the high nibble.
 *
 *   low  nibble bits 0,1,2,3 -> 7,3,6,2     (bits 0 and 2 cross into the high nibble)
 *   high nibble bits 4,5,6,7 -> 5,1,4,0     (bits 5 and 7 cross into the low nibble)
 *
 * So each S-box sends two bits to each S-box of the next round: the reason a
 * single active S-box does not stay single-active for long, and the reason the
 * single-trail probability in Act 1 collapses.
 */

const PERMUTATION: readonly number[] = [7, 3, 6, 2, 5, 1, 4, 0];

function computeInverse(perm: readonly number[]): number[] {
  const inv = new Array<number>(perm.length).fill(0);
  for (let i = 0; i < perm.length; i++) inv[perm[i]] = i;
  return inv;
}

const PERMUTATION_INV: readonly number[] = computeInverse(PERMUTATION);

export function permute(byte: number): number {
  let out = 0;
  for (let i = 0; i < 8; i++) out |= ((byte >> i) & 1) << PERMUTATION[i];
  return out & 0xff;
}

export function permuteInverse(byte: number): number {
  let out = 0;
  for (let i = 0; i < 8; i++) out |= ((byte >> i) & 1) << PERMUTATION_INV[i];
  return out & 0xff;
}

export function getPermutation(): readonly number[] {
  return PERMUTATION;
}

export function getPermutationInverse(): readonly number[] {
  return PERMUTATION_INV;
}
