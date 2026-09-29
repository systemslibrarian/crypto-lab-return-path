import { describe, expect, it } from 'vitest';
import {
  BLOCK_SIZE,
  FULL_ROUNDS,
  KEY_SCHEDULE_PERIOD,
  MAX_ROUNDS,
  decrypt,
  encrypt,
  encryptCodebook,
  encryptToRoundInput,
  generateKey,
  invertCodebook,
  lastRoundInputDiff,
  roundKey,
  traceEncryption,
} from './spn.ts';
import { getSbox, substitute, substituteInverse } from './sbox.ts';
import { getPermutation, permute, permuteInverse } from './permutation.ts';

const weak = getSbox('weak');
const strong = getSbox('strong');

/**
 * The reference implementation from crypto-lab-biham-lens, transcribed here as
 * the KAT oracle for verification gate V0 and invariant I1.
 *
 * It is written OUT LONGHAND on purpose, in the shape that lab uses — five
 * explicit subkeys, `round === 3` as the last-round test, permutation inside the
 * round function — rather than by calling `encrypt`. A test that re-derives the
 * expression under test agrees with a bug in it; this one does not share a line
 * of code with `spn.ts`, so when the two agree on all 65536 keys the agreement
 * means something.
 */
function bihamLensEncrypt(plaintext: number, masterKey: number, sboxTable: readonly number[]): number {
  const subkeys: number[] = [];
  let k = masterKey & 0xffff;
  for (let i = 0; i < 5; i++) {
    subkeys.push(k & 0xff);
    k = ((k << 4) | (k >> 12)) & 0xffff;
  }
  const applyBothNibbles = (b: number): number =>
    ((sboxTable[(b >> 4) & 0xf] << 4) | sboxTable[b & 0xf]) & 0xff;
  let state = plaintext & 0xff;
  for (let round = 0; round < 4; round++) {
    let result = state ^ subkeys[round];
    result = applyBothNibbles(result);
    if (round !== 3) result = permute(result);
    state = result & 0xff;
  }
  return (state ^ subkeys[4]) & 0xff;
}

describe('V0: the cipher is byte-for-byte the one in crypto-lab-biham-lens', () => {
  it('matches the biham-lens four-round encryption for every plaintext, over 1024 keys', () => {
    for (let i = 0; i < 1024; i++) {
      const mk = (i * 61 + 7) & 0xffff;
      const key = generateKey(mk);
      for (let p = 0; p < BLOCK_SIZE; p++) {
        expect(encrypt(p, key, weak, FULL_ROUNDS)).toBe(bihamLensEncrypt(p, mk, weak.table));
      }
    }
    // 1024 keys x 256 plaintexts, twice over. Measured 3.6s; budget 60s.
  }, 60_000);

  it('matches for the PRESENT S-box too', () => {
    for (let i = 0; i < 256; i++) {
      const mk = (i * 257 + 11) & 0xffff;
      const key = generateKey(mk);
      for (let p = 0; p < BLOCK_SIZE; p++) {
        expect(encrypt(p, key, strong, FULL_ROUNDS)).toBe(bihamLensEncrypt(p, mk, strong.table));
      }
    }
  });

  it('carries the published S-box and permutation constants', () => {
    expect([...weak.table]).toEqual([0xe, 0x4, 0xd, 0x1, 0x2, 0xf, 0xb, 0x8, 0x3, 0xa, 0x6, 0xc, 0x5, 0x9, 0x0, 0x7]);
    expect([...strong.table]).toEqual([0xc, 0x5, 0x6, 0xb, 0x9, 0x0, 0xa, 0xd, 0x3, 0xe, 0xf, 0x8, 0x4, 0x7, 0x1, 0x2]);
    expect([...getPermutation()]).toEqual([7, 3, 6, 2, 5, 1, 4, 0]);
  });

  it('reproduces the biham-lens key schedule, subkey for subkey', () => {
    expect(generateKey(0xabcd).subkeys).toEqual([0xcd, 0xda, 0xab, 0xbc, 0xcd]);
    expect(generateKey(0x1234).subkeys).toEqual([0x34, 0x41, 0x12, 0x23, 0x34]);
  });

  it('extends the round key past four rounds without touching rounds 0..4, for all 65536 keys', () => {
    for (let mk = 0; mk < 1 << 16; mk++) {
      const key = generateKey(mk);
      for (let r = 0; r <= 4; r++) expect(roundKey(key, r)).toBe(key.subkeys[r]);
    }
    // 65 536 key schedules x 5 subkeys. Measured 2.9s; budget 60s.
  }, 60_000);

  it('has a key schedule of period 4, so K_4 = K_0', () => {
    for (let mk = 0; mk < 1 << 16; mk += 7) {
      const key = generateKey(mk);
      expect(key.subkeys[4]).toBe(key.subkeys[0]);
      for (let r = 0; r <= MAX_ROUNDS; r++) {
        expect(roundKey(key, r)).toBe(roundKey(key, r + KEY_SCHEDULE_PERIOD));
      }
    }
  });
});

describe('KATs: fixed vectors', () => {
  // Every vector below was produced by the biham-lens reference above and is
  // pinned here, so a change to spn.ts that also changed the reference could
  // not hide behind their agreement.
  const vectors: [number, number, number][] = [
    [0x0000, 0x00, 0x8b],
    [0x0000, 0x3a, 0xfb],
    [0x0000, 0x5c, 0x9f],
    [0x0000, 0xff, 0x2a],
    [0x1234, 0x00, 0x0c],
    [0x1234, 0x3a, 0x33],
    [0x1234, 0x5c, 0xc7],
    [0x1234, 0xff, 0x70],
    [0xabcd, 0x00, 0x86],
    [0xabcd, 0x3a, 0x51],
    [0xabcd, 0x5c, 0xa6],
    [0xabcd, 0xff, 0x5b],
    [0xffff, 0x00, 0xc2],
    [0xffff, 0x3a, 0xba],
    [0xffff, 0x5c, 0xdd],
    [0xffff, 0xff, 0x96],
  ];

  it.each(vectors)('E4(key=%i, p=%i) = %i', (mk, p, c) => {
    expect(encrypt(p, generateKey(mk), weak, FULL_ROUNDS)).toBe(c);
  });

  it('agrees with the reference on all 16 pinned vectors', () => {
    for (const [mk, p, c] of vectors) expect(bihamLensEncrypt(p, mk, weak.table)).toBe(c);
  });
});

describe('the cipher is a permutation at every round count', () => {
  it('round-trips every plaintext, R = 1..6, both S-boxes', () => {
    for (const sbox of [weak, strong]) {
      for (let r = 1; r <= MAX_ROUNDS; r++) {
        for (const mk of [0x0000, 0x1234, 0xabcd, 0xffff, 0x8000, 0x0001]) {
          const key = generateKey(mk);
          for (let p = 0; p < BLOCK_SIZE; p++) {
            expect(decrypt(encrypt(p, key, sbox, r), key, sbox, r)).toBe(p);
          }
        }
      }
    }
  });

  it('encrypts every plaintext to a distinct ciphertext', () => {
    for (let r = 1; r <= MAX_ROUNDS; r++) {
      const book = encryptCodebook(generateKey(0xa5a5), weak, r);
      expect(new Set(book).size).toBe(BLOCK_SIZE);
    }
  });

  it('inverts a codebook exactly', () => {
    const book = encryptCodebook(generateKey(0x1357), weak, 4);
    const inv = invertCodebook(book);
    for (let p = 0; p < BLOCK_SIZE; p++) expect(inv[book[p]]).toBe(p);
  });

  it('rejects a round count outside 1..6', () => {
    const key = generateKey(1);
    expect(() => encrypt(0, key, weak, 0)).toThrow(RangeError);
    expect(() => encrypt(0, key, weak, 7)).toThrow(RangeError);
    expect(() => decrypt(0, key, weak, 1.5)).toThrow(RangeError);
  });
});

describe('S-box and permutation are involutive with their inverses', () => {
  it('substitute/substituteInverse round-trip all 256 bytes', () => {
    for (const sbox of [weak, strong]) {
      for (let b = 0; b < BLOCK_SIZE; b++) expect(substituteInverse(substitute(b, sbox), sbox)).toBe(b);
    }
  });

  it('permute/permuteInverse round-trip all 256 bytes', () => {
    for (let b = 0; b < BLOCK_SIZE; b++) expect(permuteInverse(permute(b))).toBe(b);
  });

  it('moves the documented bits: 0->7, 7->0, 1->3', () => {
    expect(permute(0b00000001)).toBe(0b10000000);
    expect(permute(0b10000000)).toBe(0b00000001);
    expect(permute(0b00000010)).toBe(0b00001000);
  });

  it('sends two bits of each nibble into each nibble', () => {
    // Every S-box feeds both S-boxes of the next round: the reason a single
    // active S-box cannot stay single-active, which Act 1 measures.
    const perm = getPermutation();
    const fromLowToHigh = [0, 1, 2, 3].filter((i) => perm[i] >= 4).length;
    const fromLowToLow = [0, 1, 2, 3].filter((i) => perm[i] < 4).length;
    const fromHighToHigh = [4, 5, 6, 7].filter((i) => perm[i] >= 4).length;
    const fromHighToLow = [4, 5, 6, 7].filter((i) => perm[i] < 4).length;
    expect([fromLowToHigh, fromLowToLow, fromHighToHigh, fromHighToLow]).toEqual([2, 2, 2, 2]);
  });
});

describe('the last-round sieve needs only K_R', () => {
  it('recovers the true last-round input difference under the true K_R, and K_(R-1) never enters it', () => {
    for (const rounds of [3, 4]) {
      for (const mk of [0x0000, 0x2468, 0xabcd, 0xffff]) {
        const key = generateKey(mk);
        for (let p1 = 0; p1 < BLOCK_SIZE; p1 += 5) {
          const p2 = (p1 ^ 0x0a) & 0xff;
          if (p2 === p1) continue;
          const c1 = encrypt(p1, key, weak, rounds);
          const c2 = encrypt(p2, key, weak, rounds);
          const truth =
            (encryptToRoundInput(p1, key, weak, rounds - 1) ^
              encryptToRoundInput(p2, key, weak, rounds - 1)) &
            0xff;
          expect(lastRoundInputDiff(c1, c2, roundKey(key, rounds), weak)).toBe(truth);
        }
      }
    }
  });

  it('is independent of K_(R-1) for every one of its 256 possible values', () => {
    // The structural claim the sieve rests on: peeling the last round gives
    //     X = S^-1(C XOR K_R) XOR K_(R-1)
    // so K_(R-1) appears in both X1 and X2 and cancels in X1 XOR X2. Checked by
    // peeling the long way with every possible K_(R-1) and watching the
    // difference not move - if it ever did, the sieve would need a 16-bit guess
    // instead of an 8-bit one.
    const key = generateKey(0x9e37);
    const rounds = 4;
    const c1 = encrypt(0x11, key, weak, rounds);
    const c2 = encrypt(0x11 ^ 0x0a, key, weak, rounds);
    for (const kr of [0x00, 0x3c, roundKey(key, rounds), 0xff]) {
      const expected = lastRoundInputDiff(c1, c2, kr, weak);
      for (let krm1 = 0; krm1 < BLOCK_SIZE; krm1++) {
        const x1 = substituteInverse((c1 ^ kr) & 0xff, weak) ^ krm1;
        const x2 = substituteInverse((c2 ^ kr) & 0xff, weak) ^ krm1;
        expect((x1 ^ x2) & 0xff).toBe(expected);
      }
    }
  });
});

describe('traceEncryption', () => {
  it('ends on the ciphertext the cipher produces', () => {
    for (let r = 1; r <= MAX_ROUNDS; r++) {
      const key = generateKey(0x4242);
      for (let p = 0; p < BLOCK_SIZE; p += 17) {
        const stages = traceEncryption(p, key, weak, r);
        expect(stages[0].state).toBe(p);
        expect(stages[stages.length - 1].state).toBe(encrypt(p, key, weak, r));
      }
    }
  });

  it('has one S-box stage per round and one fewer permutation stage', () => {
    const stages = traceEncryption(0x3a, generateKey(0xabcd), weak, 4);
    expect(stages.filter((s) => s.kind === 'sbox')).toHaveLength(4);
    expect(stages.filter((s) => s.kind === 'permute')).toHaveLength(3);
    expect(stages.filter((s) => s.kind === 'final-key')).toHaveLength(1);
  });

  it('leaves the difference of a pair unchanged across every key XOR', () => {
    // The foundation of differential cryptanalysis, checked rather than stated.
    const key = generateKey(0x1111);
    const a = traceEncryption(0x20, key, weak, 4);
    const b = traceEncryption(0x20 ^ 0x0a, key, weak, 4);
    for (let i = 1; i < a.length; i++) {
      if (a[i].kind !== 'xor-key' && a[i].kind !== 'final-key') continue;
      expect((a[i].state ^ b[i].state) & 0xff).toBe((a[i - 1].state ^ b[i - 1].state) & 0xff);
    }
  });
});
