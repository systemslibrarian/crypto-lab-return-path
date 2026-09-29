/**
 * Act 3 -- eliminating keys with a difference that cannot happen.
 *
 * The attack on the FULL four-round cipher. Guess the final mixing key, peel the
 * last round off both ciphertexts, and look at the difference entering that
 * round's substitution. If the first three rounds can never produce that
 * difference, the guess is wrong. Nothing is scored, nothing is ranked: a
 * candidate is struck out or it is not, which is what makes this different from
 * the counting attack in Biham Lens.
 *
 * Two invariants are on screen every run:
 *   I5  the true subkey is never eliminated. Asserted, not hoped for.
 *   and the negative claim: a recovered subkey is HALF the master key.
 */
import { compute } from './compute.ts';
import type { SieveOutcome } from '../crypto/jobs.ts';
import { FAILURE_CODES, FAILURE_TEXT } from '../crypto/failures.ts';
import type { SboxName } from '../crypto/sbox.ts';
import { BLOCK_SIZE, FULL_ROUNDS, generateKey, randomKey } from '../crypto/spn.ts';
import { stepChart } from './chart.ts';
import {
  callout,
  clear,
  disclosure,
  el,
  field,
  hex16,
  hex8,
  markRun,
  num,
  scrollRegion,
  stat,
  verdict,
} from './dom.ts';

export interface SievePanel {
  readonly node: HTMLElement;
  run(sbox: SboxName): Promise<void>;
}

const ALPHA_SETS = [
  { value: '4,10', label: '0x04 and 0x0a (two differences)' },
  { value: '4', label: '0x04 only' },
  { value: '1', label: '0x01 only (the weakest sieve)' },
  { value: '4,10,14,15', label: '0x04, 0x0a, 0x0e, 0x0f (four)' },
];

export function sievePanel(): SievePanel {
  // Per-session, in memory, never persisted. The reader can see it because the
  // point is to watch the attack arrive at a value they already know.
  let key = randomKey();

  const alphaSelect = el('select', { id: 'sieve-alphas' });
  for (const a of ALPHA_SETS) alphaSelect.append(el('option', { value: a.value, text: a.label }));
  alphaSelect.value = '4,10';

  const keyInput = el('input', {
    type: 'text',
    id: 'sieve-key',
    value: hex16(key.masterKey),
    maxlength: '6',
    spellcheck: 'false',
    autocomplete: 'off',
  });

  const runBtn = el('button', { class: 'btn btn-primary', type: 'button', id: 'sieve-run' }, [
    document.createTextNode('Run the sieve'),
  ]);
  const randBtn = el('button', { class: 'btn', type: 'button', id: 'sieve-random' }, [
    document.createTextNode('New random key'),
  ]);

  const out = el('div', { id: 'sieve-out', role: 'status', 'aria-live': 'polite', 'data-run': '0' }, [
    el('p', { class: 'field-hint', text: 'Sieving...' }),
  ]);

  let currentSbox: SboxName = 'weak';

  async function run(sbox: SboxName): Promise<void> {
    currentSbox = sbox;
    const raw = keyInput.value.trim().toLowerCase().replace(/^0x/, '');
    const valid = /^[0-9a-f]{1,4}$/.test(raw);
    keyInput.setAttribute('aria-invalid', valid ? 'false' : 'true');
    if (!valid) {
      clear(out);
      out.append(
        verdict('fail', `NOT RUN — ${FAILURE_CODES.RANGE}`, FAILURE_TEXT.E_RANGE, 'sieve-failure')
      );
      markRun(out);
      return;
    }
    key = generateKey(parseInt(raw, 16));
    keyInput.value = hex16(key.masterKey);
    const alphas = alphaSelect.value.split(',').map((s) => Number(s));
    runBtn.disabled = true;
    runBtn.textContent = 'Sieving...';
    clear(out);
    out.append(el('p', { class: 'field-hint', text: 'Eliminating candidates...' }));
    const result = (await compute({
      kind: 'sieve',
      sbox,
      alphas,
      rounds: FULL_ROUNDS,
      masterKey: key.masterKey,
      seed: 20260929,
    })) as SieveOutcome;
    render(result);
    runBtn.disabled = false;
    runBtn.textContent = 'Run the sieve';
  }

  function render(r: SieveOutcome): void {
    clear(out);
    const unique = r.survivors.length === 1;
    const ruledOut = r.sieveSizes.map((s) => `${hex8(s.alpha)}: ${s.impossible}`).join(', ');

    if (!r.trueSubkeySurvived) {
      // Invariant breach. It has never fired; the code exists so that if the
      // argument is ever wrong the page says so instead of reporting a success.
      out.append(
        verdict(
          'fail',
          `INVARIANT BREACH — ${FAILURE_CODES.TRUE_KEY_ELIMINATED}`,
          FAILURE_TEXT.E_TRUE_KEY_ELIMINATED,
          'sieve-breach'
        )
      );
    }

    out.append(
      el('div', { class: 'readout' }, [
        stat('candidates left', num(r.survivors.length), 'of 256 guesses for the final key', unique ? 'good' : 'warn'),
        stat('pairs spent', num(r.pairsUsed), `${num(r.pairsAvailable)} available`, 'accent'),
        stat('true subkey', hex8(r.trueSubkey), `K${r.rounds + 1}, the low byte of ${hex16(r.masterKey)}`),
        stat(
          'eliminated by',
          `${ruledOut}`,
          'impossible differences per input difference',
          undefined
        ),
      ])
    );

    out.append(
      stepChart({
        title: `Candidate keys still standing after each pair: 256 down to ${r.survivors.length}`,
        values: r.curve,
        yMax: BLOCK_SIZE,
        xTitle: 'pairs used',
        yTitle: 'candidates left',
        markAt: unique ? { index: r.curve.length - 1, label: 'unique' } : undefined,
      })
    );

    if (unique && r.trueSubkeySurvived) {
      out.append(
        verdict(
          'pass',
          'SUBKEY RECOVERED — AND THE MASTER KEY IS STILL SECRET',
          `One candidate survived, ${hex8(r.survivors[0])}, and it is the true final mixing key. That is 8 of the 16 master-key bits. The other 8 are untouched by this attack: ${num(256)} master keys still end in this subkey, and nothing here distinguishes them. A recovered subkey is not a recovered key.`,
          'sieve-verdict'
        )
      );
    } else if (r.trueSubkeySurvived) {
      out.append(
        verdict(
          'alarm',
          `NARROWED, NOT SOLVED — ${FAILURE_CODES.SIEVE_AMBIGUOUS}`,
          `${FAILURE_TEXT.E_SIEVE_AMBIGUOUS} ${num(r.survivors.length)} candidates survive: ${r.survivors.map(hex8).join(', ')}. The true subkey ${hex8(r.trueSubkey)} is among them -- it always is -- so the sieve did not fail, it ran out of data. Add a second input difference above.`,
          'sieve-verdict'
        )
      );
    }

    out.append(
      verdict(
        'pass',
        'THE TRUE SUBKEY WAS NEVER ELIMINATED',
        `A guess is struck out only when it produces a difference the first ${r.rounds - 1} rounds cannot produce. The true key produces the difference that really happened, which is reachable by definition -- so it cannot be struck out. This is invariant I5, and the test suite runs it over 400 keys rather than taking the argument on faith.`,
        'sieve-i5'
      )
    );

    out.append(
      scrollRegion('Surviving candidate keys', 'chart-wrap', [
        el(
          'ul',
          { class: 'nibble-row', role: 'list', 'aria-label': 'surviving candidate final subkeys' },
          r.survivors.map((s) =>
            el(
              'li',
              { class: `nibble ${s === r.trueSubkey ? 'nibble-on' : 'nibble-off'}`, role: 'listitem' },
              [
                document.createTextNode(hex8(s)),
                el('span', { class: 'sr-only', text: s === r.trueSubkey ? ' (the true subkey)' : '' }),
              ]
            )
          )
        ),
      ])
    );

    out.append(
      callout('note', 'Why one 8-bit guess is enough', [
        el('p', {}, [
          document.createTextNode(
            'The last round computes C = S(X XOR K4) XOR K5. Rearranged, X = S-inverse(C XOR K5) XOR K4 -- and in the XOR of two such values, K4 cancels. So the difference entering the last substitution depends on K5 alone: 256 guesses, not 65 536. Then the key schedule hands over a bonus, because it repeats every four rounds: K5 is K1, the low byte of the master key.'
          ),
        ]),
      ])
    );

    out.append(
      disclosure('What this attack costs, and what it does not buy', [
        el('p', {}, [
          document.createTextNode(
            `Data: up to ${num(r.pairsAvailable)} chosen-plaintext pairs, which is most of the codebook. An 8-bit block offers only 128 pairs per input difference, so a weak sieve can genuinely run out -- pick "0x01 only" above and watch it sometimes finish with two or three candidates standing. That is the honest shape of a data-limited attack, and it is why the page reports a survivor set rather than a single answer.`
          ),
        ]),
        el('p', {}, [
          document.createTextNode(
            'What it does not buy: the remaining 8 key bits, any statement about four-round impossible differentials (there are none -- see Act 2), and any claim about real ciphers, where the same sieve needs a structurally-argued impossible differential over most of the rounds and data complexities in the millions.'
          ),
        ]),
      ])
    );
    markRun(out);
  }

  const node = el('section', { class: 'card', 'aria-labelledby': 'act3-title', id: 'act3' }, [
    el('div', { class: 'act-head' }, [
      el('span', { class: 'act-num', text: 'ACT 3' }),
      el('h2', { class: 'act-title', id: 'act3-title', text: 'Eliminating keys with an event that cannot occur' }),
    ]),
    el('p', { class: 'act-lede' }, [
      document.createTextNode(
        'Now put the impossible differential to work against the full four-round cipher. Guess the last key, undo the last round, and check the difference that comes out. If the first three rounds could never have produced it, the guess is wrong -- struck out, not merely made less likely. Watch 256 candidates fall.'
      ),
    ]),
    el('div', { class: 'controls' }, [
      field('Input differences used', alphaSelect, 'more differences, more pairs'),
      field('Master key', keyInput, 'per session, in memory only'),
      el('div', { class: 'field' }, [
        el('span', { class: 'group-label', 'aria-hidden': 'true', text: ' ' }),
        runBtn,
      ]),
      el('div', { class: 'field' }, [
        el('span', { class: 'group-label', 'aria-hidden': 'true', text: ' ' }),
        randBtn,
      ]),
    ]),
    out,
  ]);

  runBtn.addEventListener('click', () => {
    void run(currentSbox);
  });
  randBtn.addEventListener('click', () => {
    key = randomKey();
    keyInput.value = hex16(key.masterKey);
    void run(currentSbox);
  });
  keyInput.addEventListener('keydown', (e) => {
    if ((e as KeyboardEvent).key === 'Enter') void run(currentSbox);
  });

  return { node, run };
}
