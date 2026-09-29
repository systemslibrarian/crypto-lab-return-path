/**
 * The 4-bit S-boxes of the toy SPN.
 *
 * PROVENANCE (verification gate V0). These are the S-boxes of
 * `crypto-lab-biham-lens` (`demos/biham-lens/src/crypto/sbox.ts`) and
 * `crypto-lab-matsui-line` (`src/crypto/sbox.ts`), copied byte for byte so that
 * the differential lab, the linear lab and this one attack the same cipher.
 *
 *   weak   — the textbook S-box from Heys' tutorial / Stinson's *Cryptography*
 *            3rd ed. Maximum DDT entry 8 of 16, i.e. a differential that holds
 *            half the time. The default here, because an attack you cannot
 *            measure teaches nothing.
 *   strong — the PRESENT S-box (Bogdanov et al., CHES 2007). Maximum DDT entry
 *            4, the smallest achievable for a 4-bit permutation.
 *
 * Both are permutations of the nibbles, so both are invertible — which the
 * boomerang needs, since it decrypts.
 */

export type SboxName = 'weak' | 'strong';

/** Heys / Stinson textbook S-box. max DDT = 8. */
const SBOX_WEAK: readonly number[] = [
  0xe, 0x4, 0xd, 0x1, 0x2, 0xf, 0xb, 0x8, 0x3, 0xa, 0x6, 0xc, 0x5, 0x9, 0x0, 0x7,
];

/** PRESENT S-box (Bogdanov et al., CHES 2007). max DDT = 4. */
const SBOX_STRONG: readonly number[] = [
  0xc, 0x5, 0x6, 0xb, 0x9, 0x0, 0xa, 0xd, 0x3, 0xe, 0xf, 0x8, 0x4, 0x7, 0x1, 0x2,
];

export interface Sbox {
  readonly name: SboxName;
  /** S[x] for x in 0..15. */
  readonly table: readonly number[];
  /** S^-1[y] for y in 0..15. */
  readonly inverse: readonly number[];
}

function invert(table: readonly number[]): number[] {
  const inv = new Array<number>(table.length).fill(0);
  for (let i = 0; i < table.length; i++) inv[table[i]] = i;
  return inv;
}

function build(name: SboxName, table: readonly number[]): Sbox {
  return { name, table, inverse: invert(table) };
}

export const SBOXES: Readonly<Record<SboxName, Sbox>> = {
  weak: build('weak', SBOX_WEAK),
  strong: build('strong', SBOX_STRONG),
};

export const SBOX_NAMES: readonly SboxName[] = ['weak', 'strong'];

/** Human label for a control. */
export const SBOX_LABEL: Readonly<Record<SboxName, string>> = {
  weak: 'Textbook (max DDT 8)',
  strong: 'PRESENT (max DDT 4)',
};

export function getSbox(name: SboxName): Sbox {
  const s = SBOXES[name];
  if (!s) throw new RangeError(`unknown S-box: ${String(name)}`);
  return s;
}

/** Apply the S-box to both nibbles of a byte. */
export function substitute(byte: number, sbox: Sbox): number {
  return ((sbox.table[(byte >> 4) & 0xf] << 4) | sbox.table[byte & 0xf]) & 0xff;
}

/** Undo `substitute`. */
export function substituteInverse(byte: number, sbox: Sbox): number {
  return ((sbox.inverse[(byte >> 4) & 0xf] << 4) | sbox.inverse[byte & 0xf]) & 0xff;
}
