import { describe, expect, it } from 'vitest';
import { SBOX_NAMES, getSbox, substitute, substituteInverse } from './sbox.ts';
import {
  NIBBLE_VALUES,
  computeBCT,
  computeDDT,
  layerProbability,
  layerSupport,
  switchProbabilityBCT,
  switchProbabilityTrail,
  tablesFor,
} from './tables.ts';
import { BLOCK_SIZE } from './spn.ts';

/**
 * INDEPENDENT RE-DERIVATION (template section 4.1b). Neither brute-force below
 * shares a line with `tables.ts`: the DDT is recomputed from an explicit
 * pair-enumeration over a plain array, and the BCT is recomputed by literally
 * running the four S-box calls of its definition on every input. A test that
 * called `computeDDT` twice would agree with a bug in it.
 */
function bruteDDT(table: readonly number[]): number[][] {
  const t: number[][] = [];
  for (let a = 0; a < 16; a++) {
    const row = new Array<number>(16).fill(0);
    for (let x = 0; x < 16; x++) {
      for (let y = 0; y < 16; y++) {
        if ((x ^ y) === a && (table[x] ^ table[y]) !== undefined) {
          // count ordered pairs (x, y) with x XOR y = a, one per x
          if (y === (x ^ a)) row[table[x] ^ table[y]]++;
        }
      }
    }
    t.push(row);
  }
  return t;
}

function bruteBCT(table: readonly number[]): number[][] {
  const inv = new Array<number>(16).fill(0);
  for (let i = 0; i < 16; i++) inv[table[i]] = i;
  const t: number[][] = [];
  for (let a = 0; a < 16; a++) {
    const row = new Array<number>(16).fill(0);
    for (let b = 0; b < 16; b++) {
      let n = 0;
      for (let x = 0; x < 16; x++) {
        const left = inv[table[x] ^ b];
        const right = inv[table[x ^ a] ^ b];
        if ((left ^ right) === a) n++;
      }
      row[b] = n;
    }
    t.push(row);
  }
  return t;
}

describe.each(SBOX_NAMES)('tables for the %s S-box', (name) => {
  const sbox = getSbox(name);
  const { ddt, bct } = tablesFor(sbox);

  it('DDT matches an independent brute-force re-derivation', () => {
    expect(ddt.map((r) => [...r])).toEqual(bruteDDT(sbox.table));
  });

  it('BCT matches an independent brute-force re-derivation', () => {
    expect(bct.map((r) => [...r])).toEqual(bruteBCT(sbox.table));
  });

  it('I3: every DDT row sums to 16', () => {
    for (let a = 0; a < NIBBLE_VALUES; a++) {
      expect(ddt[a].reduce((x, y) => x + y, 0)).toBe(NIBBLE_VALUES);
    }
  });

  it('DDT row 0 is the identity: a zero difference in means a zero difference out', () => {
    expect(ddt[0][0]).toBe(NIBBLE_VALUES);
    for (let b = 1; b < NIBBLE_VALUES; b++) expect(ddt[0][b]).toBe(0);
  });

  it('DDT column 0 is zero off the diagonal: an S-box is a permutation', () => {
    for (let a = 1; a < NIBBLE_VALUES; a++) expect(ddt[a][0]).toBe(0);
  });

  it('V2 identity 1: the BCT first row and first column are all 2^n = 16', () => {
    for (let i = 0; i < NIBBLE_VALUES; i++) {
      expect(bct[i][0]).toBe(NIBBLE_VALUES);
      expect(bct[0][i]).toBe(NIBBLE_VALUES);
    }
  });

  it('V2 identity 2: BCT >= DDT pointwise, so a one-layer switch can only help the boomerang', () => {
    for (let a = 0; a < NIBBLE_VALUES; a++) {
      for (let b = 0; b < NIBBLE_VALUES; b++) {
        expect(bct[a][b]).toBeGreaterThanOrEqual(ddt[a][b]);
      }
    }
  });

  it('V2 identity 3: BCT entries are even for a nonzero input difference', () => {
    for (let a = 1; a < NIBBLE_VALUES; a++) {
      for (let b = 0; b < NIBBLE_VALUES; b++) expect(bct[a][b] % 2).toBe(0);
    }
  });

  it('every DDT entry is even: solutions come in pairs {x, x XOR a}', () => {
    for (let a = 1; a < NIBBLE_VALUES; a++) {
      for (let b = 0; b < NIBBLE_VALUES; b++) expect(ddt[a][b] % 2).toBe(0);
    }
  });

  it('DDT counts real S-box pairs: every nonzero entry is realised by a concrete input', () => {
    for (let a = 1; a < NIBBLE_VALUES; a++) {
      for (let b = 0; b < NIBBLE_VALUES; b++) {
        let found = 0;
        for (let x = 0; x < NIBBLE_VALUES; x++) {
          if ((sbox.table[x] ^ sbox.table[x ^ a]) === b) found++;
        }
        expect(found).toBe(ddt[a][b]);
      }
    }
  });

  it('BCT counts real round trips: every entry is realised by running the S-box', () => {
    for (let a = 0; a < NIBBLE_VALUES; a++) {
      for (let b = 0; b < NIBBLE_VALUES; b++) {
        let found = 0;
        for (let x = 0; x < NIBBLE_VALUES; x++) {
          const back1 = sbox.inverse[sbox.table[x] ^ b];
          const back2 = sbox.inverse[sbox.table[x ^ a] ^ b];
          if ((back1 ^ back2) === a) found++;
        }
        expect(found).toBe(bct[a][b]);
      }
    }
  });

  it('layerSupport is exactly the set of byte differences with nonzero layer probability', () => {
    for (let from = 1; from < BLOCK_SIZE; from += 11) {
      const support = new Set(layerSupport(ddt, from));
      for (let to = 0; to < BLOCK_SIZE; to++) {
        expect(support.has(to)).toBe(layerProbability(ddt, from, to) > 0);
      }
    }
  });

  it('layer probabilities over the whole support sum to 1', () => {
    for (let from = 1; from < BLOCK_SIZE; from += 7) {
      let total = 0;
      for (let to = 0; to < BLOCK_SIZE; to++) total += layerProbability(ddt, from, to);
      expect(total).toBeCloseTo(1, 12);
    }
  });

  it('the BCT switch probability is never below the trail reading of the same switch', () => {
    for (let beta = 1; beta < BLOCK_SIZE; beta += 5) {
      for (let gamma = 1; gamma < BLOCK_SIZE; gamma += 5) {
        expect(switchProbabilityBCT(bct, beta, gamma)).toBeGreaterThanOrEqual(
          switchProbabilityTrail(ddt, beta, gamma) - 1e-15
        );
      }
    }
  });
});

describe('the published maxima', () => {
  it('the textbook S-box has max DDT 8 and the PRESENT S-box has max DDT 4', () => {
    expect(tablesFor(getSbox('weak')).maxDdt).toBe(8);
    expect(tablesFor(getSbox('strong')).maxDdt).toBe(4);
  });

  it('the textbook S-box has a nontrivial BCT entry of 10, above its DDT maximum of 8', () => {
    expect(tablesFor(getSbox('weak')).maxBct).toBe(10);
  });

  it('the PRESENT S-box has two probability-1 switches where its DDT maximum is 4', () => {
    // Two positions where a 4-uniform S-box lets the boomerang cross for free.
    // At (1,5) the one-way DDT entry is 0 outright; at (f,f) it is 4 of 16, so
    // the trail reading charges (4/16)^2 = 1/16 for a crossing that in fact
    // never fails. This is the whole reason the BCT was published.
    const { ddt, bct } = tablesFor(getSbox('strong'));
    expect(tablesFor(getSbox('strong')).maxBct).toBe(16);
    const spots: [number, number, number][] = [];
    for (let a = 1; a < NIBBLE_VALUES; a++) {
      for (let b = 1; b < NIBBLE_VALUES; b++) if (bct[a][b] === 16) spots.push([a, b, ddt[a][b]]);
    }
    expect(spots).toEqual([
      [0x1, 0x5, 0],
      [0xf, 0xf, 4],
    ]);
  });

  it('the textbook S-box amplifies eight switches from a DDT entry to a BCT of 10', () => {
    // Where Act 5's headline case lives. Each entry is (input difference,
    // ciphertext-side difference, DDT entry) with a BCT entry of 10 - so the
    // trail reading charges (DDT/16)^2 for a crossing that really succeeds
    // 10/16 of the time.
    const { ddt, bct } = tablesFor(getSbox('weak'));
    const spots: [number, number, number][] = [];
    for (let a = 1; a < NIBBLE_VALUES; a++) {
      for (let b = 1; b < NIBBLE_VALUES; b++) if (bct[a][b] === 10) spots.push([a, b, ddt[a][b]]);
    }
    expect(spots).toEqual([
      [0x4, 0x3, 2],
      [0xa, 0x8, 6],
      [0xb, 0x5, 2],
      [0xb, 0x7, 2],
      [0xb, 0xd, 2],
      [0xb, 0xf, 2],
      [0xe, 0x8, 6],
      [0xf, 0x1, 2],
    ]);
  });
});

describe('the substitution layer the tables describe', () => {
  it('substitute applies the S-box to each nibble independently', () => {
    const sbox = getSbox('weak');
    for (let b = 0; b < BLOCK_SIZE; b++) {
      expect(substitute(b, sbox)).toBe((sbox.table[(b >> 4) & 0xf] << 4) | sbox.table[b & 0xf]);
      expect(substituteInverse(substitute(b, sbox), sbox)).toBe(b);
    }
  });

  it('DDT and BCT of a byte-wide layer factor over the two nibbles', () => {
    // The tables are 16x16 but the cipher's layer is 8 bits wide; the factoring
    // is why a byte-wide probability is a product of two entries.
    const sbox = getSbox('weak');
    const ddt = computeDDT(sbox);
    for (const beta of [0x08, 0x4c, 0xbf]) {
      for (const gamma of [0x10, 0x51, 0x05]) {
        let count = 0;
        for (let x = 0; x < BLOCK_SIZE; x++) {
          if (((substitute(x, sbox) ^ substitute(x ^ beta, sbox)) & 0xff) === gamma) count++;
        }
        expect(count / BLOCK_SIZE).toBeCloseTo(layerProbability(ddt, beta, gamma), 12);
      }
    }
  });

  it('computeBCT of a byte-wide layer factors over the two nibbles too', () => {
    const sbox = getSbox('weak');
    const bct = computeBCT(sbox);
    for (const beta of [0x08, 0x02, 0xbf]) {
      for (const gamma of [0x10, 0x05, 0x51]) {
        let count = 0;
        for (let x = 0; x < BLOCK_SIZE; x++) {
          const y = substitute(x, sbox);
          const yp = substitute(x ^ beta, sbox);
          const w = substituteInverse((y ^ gamma) & 0xff, sbox);
          const wp = substituteInverse((yp ^ gamma) & 0xff, sbox);
          if (((w ^ wp) & 0xff) === beta) count++;
        }
        expect(count / BLOCK_SIZE).toBeCloseTo(switchProbabilityBCT(bct, beta, gamma), 12);
      }
    }
  });
});
