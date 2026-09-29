/**
 * Act 0 -- the cipher, shown the way the two sibling labs show it, so a reader
 * arriving from either recognises the target rather than wondering whether this
 * is a different cipher.
 */
import { NIBBLE_VALUES } from '../crypto/tables.ts';
import { getPermutation } from '../crypto/permutation.ts';
import {
  BLOCK_BITS,
  FULL_ROUNDS,
  KEY_SCHEDULE_PERIOD,
  generateKey,
  type SpnKey,
} from '../crypto/spn.ts';
import { getSbox, type Sbox, type SboxName } from '../crypto/sbox.ts';
import { disclosure, el, hex16, hex4, hex8, scrollRegion } from './dom.ts';

function sboxTable(sbox: Sbox): HTMLElement {
  const head = el('tr', {}, [
    el('th', { scope: 'row', text: 'x' }),
    ...Array.from({ length: NIBBLE_VALUES }, (_, i) => el('td', { text: hex4(i) })),
  ]);
  const body = el('tr', {}, [
    el('th', { scope: 'row', text: 'S(x)' }),
    ...Array.from({ length: NIBBLE_VALUES }, (_, i) => el('td', { text: hex4(sbox.table[i]) })),
  ]);
  return scrollRegion(`${sbox.name} S-box lookup table`, 'table-wrap', [
    el('table', {}, [
      el('caption', {
        text:
          sbox.name === 'weak'
            ? 'The textbook S-box. Every nibble maps to a different nibble, so it is invertible -- which the boomerang needs, because it decrypts.'
            : 'The PRESENT S-box (Bogdanov et al., CHES 2007).',
      }),
      el('tbody', {}, [head, body]),
    ]),
  ]);
}

function permTable(): HTMLElement {
  const perm = getPermutation();
  return scrollRegion('Bit permutation table', 'table-wrap', [
    el('table', {}, [
      el('caption', {
        text: 'Input bit i is written to output position P[i]. Bit 0 is the least significant; bits 0-3 are the low S-box, 4-7 the high one.',
      }),
      el('tbody', {}, [
        el('tr', {}, [
          el('th', { scope: 'row', text: 'i' }),
          ...perm.map((_, i) => el('td', { text: String(i) })),
        ]),
        el('tr', {}, [
          el('th', { scope: 'row', text: 'P[i]' }),
          ...perm.map((p) => el('td', { text: String(p) })),
        ]),
      ]),
    ]),
  ]);
}

function scheduleTable(key: SpnKey): HTMLElement {
  return scrollRegion('Round key schedule', 'table-wrap', [
    el('table', {}, [
      el('caption', {
        text: `Subkeys for master key ${hex16(key.masterKey)}: take the low byte, rotate the 16-bit key left by four bits, repeat. Rotating left by four has order four, so the schedule repeats every ${KEY_SCHEDULE_PERIOD} rounds and K5 is already K1.`,
      }),
      el('tbody', {}, [
        el('tr', {}, [
          el('th', { scope: 'row', text: 'round' }),
          ...key.subkeys.map((_, i) => el('td', { text: `K${i + 1}` })),
        ]),
        el('tr', {}, [
          el('th', { scope: 'row', text: 'subkey' }),
          ...key.subkeys.map((k) => el('td', { text: hex8(k) })),
        ]),
      ]),
    ]),
  ]);
}

export interface CipherPanel {
  readonly node: HTMLElement;
  render(sboxName: SboxName): void;
}

/**
 * Act 0 re-renders when the global control changes.
 *
 * It did not, at first, and the claims suite caught it: after switching to the
 * PRESENT table the page went on printing the textbook S-box here while every
 * measurement below used the other one. One part of a page describing a
 * different cipher from the rest is the exact failure this lab exists to warn
 * about, so it is now a rendered function of the control like everything else.
 */
export function cipherPanel(): CipherPanel {
  const tables = el('div', { id: 'act0-tables' });
  const key = generateKey(0xabcd);
  const section = el('section', { class: 'card', 'aria-labelledby': 'act0-title', id: 'act0' }, [
    el('div', { class: 'act-head' }, [
      el('span', { class: 'act-num', text: 'ACT 0' }),
      el('h2', { class: 'act-title', id: 'act0-title', text: 'The cipher you already broke' }),
    ]),
    el('p', { class: 'act-lede' }, [
      document.createTextNode('The same toy cipher two other labs attack, so three attacks land on one target. An '),
      el('strong', { text: `${BLOCK_BITS}-bit block` }),
      document.createTextNode(', a 16-bit key, and '),
      el('strong', { text: `${FULL_ROUNDS} rounds` }),
      document.createTextNode(
        ' of: mix in the round key, push both halves of the byte through a 4-bit substitution table, then shuffle the bits. The last round skips the shuffle.'
      ),
    ]),
  ]);

  section.append(
    el('dl', { class: 'kv' }, [
      el('dt', { text: 'block' }),
      el('dd', { text: '8 bits (256 plaintexts -- the whole codebook fits on this page)' }),
      el('dt', { text: 'key' }),
      el('dd', { text: '16 bits (65 536 keys -- so can the whole key space)' }),
      el('dt', { text: 'round' }),
      el('dd', { text: 'state <- S(state XOR K_r), then permute (except in the last round)' }),
      el('dt', { text: 'output' }),
      el('dd', { text: 'ciphertext <- state XOR K_(R+1)' }),
    ])
  );

  section.append(
    el('p', {}, [
      document.createTextNode('Seen before in '),
      el('a', { href: 'https://systemslibrarian.github.io/crypto-lab-biham-lens/', target: '_blank', rel: 'noopener', text: 'Biham Lens' }),
      document.createTextNode(' (differential cryptanalysis, and where this cipher is defined) and '),
      el('a', { href: 'https://systemslibrarian.github.io/crypto-lab-matsui-line/', target: '_blank', rel: 'noopener', text: 'Matsui Line' }),
      document.createTextNode(
        ' (linear cryptanalysis). Its known-answer tests pass here unchanged; if they ever stop, the build fails.'
      ),
    ])
  );

  section.append(
    disclosure('Inspect the evidence: S-box, bit permutation, key schedule', [
      tables,
      el('p', {}, [
        document.createTextNode(
          'A detail worth carrying into Act 3: the key schedule repeats every four rounds, so the final mixing key of the four-round cipher is the first round key again -- the low byte of the master key. Recovering it recovers half the key.'
        ),
      ]),
    ])
  );

  function render(sboxName: SboxName): void {
    tables.replaceChildren(sboxTable(getSbox(sboxName)), permTable(), scheduleTable(key));
  }
  render('weak');

  return { node: section, render };
}
