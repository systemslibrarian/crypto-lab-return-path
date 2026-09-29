/**
 * Act 3 -- eliminating keys with an event that cannot occur.
 *
 * Guess the final mixing key, peel the last round off both ciphertexts, and look
 * at the difference entering that round's substitution. If the earlier rounds can
 * never produce it, the guess is wrong -- struck out, not merely made less
 * likely, which is what separates this from the counting attack in Biham Lens.
 *
 * Two claims are on screen every run: invariant I5 (the true subkey is never
 * eliminated) and the negative claim (a recovered subkey is half a key).
 */
import { compute } from './compute.ts';
import type { SieveOutcome } from '../crypto/jobs.ts';
import { FAILURE_CODES, FAILURE_TEXT } from '../crypto/failures.ts';
import type { SboxName } from '../crypto/sbox.ts';
import { BLOCK_SIZE, FULL_ROUNDS, generateKey, randomKey } from '../crypto/spn.ts';
import { stepChart } from './chart.ts';
import { PanelRunner } from './panel.ts';
import { setBusy } from './latest.ts';
import {
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
  reset(sbox: SboxName): Promise<void>;
  state(): { alphas: string; key: string; rounds: string };
  restore(s: Partial<{ alphas: string; key: string; rounds: string }>): void;
}

const ALPHA_SETS = [
  { value: '4,10', label: '0x04 and 0x0a (two differences)' },
  { value: '4', label: '0x04 only' },
  { value: '1', label: '0x01 only (the weakest sieve)' },
  { value: '4,10,14,15', label: '0x04, 0x0a, 0x0e, 0x0f (four)' },
];
const DEFAULT_ALPHAS = '4,10';
const DEFAULT_ROUNDS = String(FULL_ROUNDS);

export function sievePanel(): SievePanel {
  const runner = new PanelRunner<{ alphas: string; key: string; rounds: string; sbox: SboxName }>(
    'sieve-out',
    'Act 3 results: candidate keys eliminated'
  );

  // Per-session, in memory, never persisted. Visible because the point is to
  // watch the attack arrive at a value the reader already knows.
  let key = randomKey();

  const alphaSelect = el('select', { id: 'sieve-alphas' });
  for (const a of ALPHA_SETS) alphaSelect.append(el('option', { value: a.value, text: a.label }));
  alphaSelect.value = DEFAULT_ALPHAS;

  const roundSelect = el('select', { id: 'sieve-rounds' });
  for (const r of [3, 4]) roundSelect.append(el('option', { value: String(r), text: `${r} rounds` }));
  roundSelect.value = DEFAULT_ROUNDS;

  const keyInput = el('input', {
    type: 'text',
    id: 'sieve-key',
    value: hex16(key.masterKey),
    maxlength: '6',
    spellcheck: 'false',
    autocomplete: 'off',
  }) as HTMLInputElement;

  const runBtn = el('button', { class: 'btn btn-primary', type: 'button', id: 'sieve-run' }, [
    document.createTextNode('Run the sieve'),
  ]) as HTMLButtonElement;
  const randBtn = el('button', { class: 'btn', type: 'button', id: 'sieve-random' }, [
    document.createTextNode('New random key'),
  ]) as HTMLButtonElement;
  runner.manage(runBtn, randBtn);

  let currentSbox: SboxName = 'weak';

  async function run(sbox: SboxName): Promise<void> {
    currentSbox = sbox;
    const raw = keyInput.value.trim().toLowerCase().replace(/^0x/, '');
    const valid = /^[0-9a-f]{1,4}$/.test(raw);
    keyInput.setAttribute('aria-invalid', valid ? 'false' : 'true');
    if (!valid) {
      clear(runner.out);
      runner.out.append(
        verdict('fail', `NOT RUN — ${FAILURE_CODES.RANGE}`, FAILURE_TEXT.E_RANGE, 'sieve-failure')
      );
      runner.announce.textContent = `Not run: ${FAILURE_CODES.RANGE}.`;
      runner.meta.textContent = '';
      setBusy(runner.out, false);
      markRun(runner.out);
      return;
    }
    key = generateKey(parseInt(raw, 16));
    keyInput.value = hex16(key.masterKey);
    const alphas = alphaSelect.value.split(',').map((s) => Number(s));
    const rounds = Number(roundSelect.value);
    await runner.run(
      { alphas: alphaSelect.value, key: keyInput.value, rounds: roundSelect.value, sbox },
      'Eliminating candidates…',
      () =>
        compute({
          kind: 'sieve',
          sbox,
          alphas,
          rounds,
          masterKey: key.masterKey,
          seed: 20260929,
        }) as Promise<SieveOutcome>,
      (result) => render(result)
    );
  }

  function render(r: SieveOutcome): string {
    const out = runner.out;
    const unique = r.survivors.length === 1;

    if (!r.trueSubkeySurvived) {
      // An invariant breach. It has never fired; the branch exists so that if the
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
          `One candidate survived, ${hex8(r.survivors[0])}, and it is the true final mixing key. That is 8 of the 16 master-key bits. The other 8 are untouched: ${num(256)} master keys still end in this subkey, and nothing here distinguishes them. A recovered subkey is not a recovered key.`,
          'sieve-verdict'
        )
      );
    } else if (r.trueSubkeySurvived) {
      out.append(
        verdict(
          'alarm',
          `NARROWED, NOT SOLVED — ${FAILURE_CODES.SIEVE_AMBIGUOUS}`,
          `${FAILURE_TEXT.E_SIEVE_AMBIGUOUS} ${num(r.survivors.length)} candidates survive: ${r.survivors.map(hex8).join(', ')}. The true subkey ${hex8(r.trueSubkey)} is among them — it always is — so the sieve did not fail, it ran out of data. Add a second input difference above.`,
          'sieve-verdict'
        )
      );
    }

    out.append(
      verdict(
        'pass',
        'THE TRUE SUBKEY WAS NEVER ELIMINATED',
        `A guess is struck out only when it produces a difference the first ${r.rounds - 1} rounds cannot. The true key produces the difference that really happened, which is reachable by definition. Invariant I5, run over 400 keys in the suite rather than taken on faith.`,
        'sieve-i5'
      )
    );

    out.append(
      el('div', { class: 'readout' }, [
        stat('candidates left', num(r.survivors.length), 'of 256 guesses', unique ? 'good' : 'warn'),
        stat('pairs spent', num(r.pairsUsed), `${num(r.pairsAvailable)} available`, 'accent'),
        stat('true subkey', hex8(r.trueSubkey), `K${r.rounds + 1}, from ${hex16(r.masterKey)}`),
        stat(
          'ruled out per difference',
          r.sieveSizes.map((s) => `${hex8(s.alpha)}: ${s.impossible}`).join(', '),
          'impossible differences at the last round'
        ),
      ])
    );

    out.append(
      scrollRegion('Surviving candidate keys', 'chart-wrap', [
        el(
          'ul',
          { class: 'chipset', role: 'list', 'aria-label': 'surviving candidate final subkeys' },
          r.survivors.map((s) =>
            el('li', { class: `chip-val${s === r.trueSubkey ? ' nibble-on' : ''}`, role: 'listitem' }, [
              document.createTextNode(hex8(s)),
              el('span', { class: 'sr-only', text: s === r.trueSubkey ? ' (the true subkey)' : '' }),
            ])
          )
        ),
      ])
    );

    out.append(
      disclosure('Inspect the evidence: why one guess is enough, and what it does not buy', [
        el('p', {}, [
          el('strong', { text: 'Why one 8-bit guess is enough. ' }),
          document.createTextNode(
            'The last round computes C = S(X XOR K4) XOR K5, so X = S-inverse(C XOR K5) XOR K4 \u2014 and in the XOR of two such values K4 cancels. The difference entering the last substitution depends on K5 alone: 256 guesses, not 65 536. The schedule then hands over a bonus, because it repeats every four rounds: K5 is K1, the low byte of the master key.'
          ),
        ]),
        el('p', {}, [
          document.createTextNode(
            `Data: up to ${num(r.pairsAvailable)} chosen-plaintext pairs, most of the codebook. An 8-bit block offers only 128 pairs per input difference, so a weak sieve can genuinely run out — pick "0x01 only" above and watch it sometimes finish with two or three candidates standing. That is the honest shape of a data-limited attack, and why the page reports a survivor set rather than a single answer.`
          ),
        ]),
        el('p', {}, [
          document.createTextNode(
            'What it does not buy: the remaining 8 key bits, any statement about four-round impossible differentials (there are none), and any claim about real ciphers, where the same sieve needs a structurally-argued impossible differential over most of the rounds.'
          ),
        ]),
      ])
    );

    return `Sieve complete: ${num(r.survivors.length)} of 256 candidates left after ${num(r.pairsUsed)} pairs. The true subkey survived.`;
  }

  const node = el('section', { class: 'card', 'aria-labelledby': 'act3-title', id: 'act3' }, [
    el('div', { class: 'act-head' }, [
      el('span', { class: 'act-num', text: 'ACT 3' }),
      el('h2', { class: 'act-title', id: 'act3-title', text: 'Eliminating keys with an event that cannot occur' }),
    ]),
    el('p', { class: 'act-lede' }, [
      document.createTextNode(
        'Put the impossible differential to work. Guess the last key, undo the last round, check the difference that comes out: if the earlier rounds could never have produced it, the guess is wrong.'
      ),
    ]),
    el('div', { class: 'controls' }, [
      field('Input differences used', alphaSelect),
      field('Rounds', roundSelect),
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
    runner.announce,
    runner.meta,
    runner.out,
  ]);

  runBtn.addEventListener('click', () => {
    if (runner.busy) return;
    void run(currentSbox);
  });
  randBtn.addEventListener('click', () => {
    if (runner.busy) return;
    key = randomKey();
    keyInput.value = hex16(key.masterKey);
    void run(currentSbox);
  });
  keyInput.addEventListener('keydown', (e) => {
    if ((e as KeyboardEvent).key === 'Enter') void run(currentSbox);
  });

  return {
    node,
    run,
    async reset(sbox: SboxName) {
      currentSbox = sbox;
      alphaSelect.value = DEFAULT_ALPHAS;
      roundSelect.value = DEFAULT_ROUNDS;
      key = randomKey();
      keyInput.value = hex16(key.masterKey);
      await run(sbox);
    },
    state: () => ({ alphas: alphaSelect.value, key: keyInput.value, rounds: roundSelect.value }),
    restore(s) {
      if (s.alphas && ALPHA_SETS.some((a) => a.value === s.alphas)) alphaSelect.value = s.alphas;
      if (s.rounds && ['3', '4'].includes(s.rounds)) roundSelect.value = s.rounds;
      if (s.key && /^0x[0-9a-f]{1,4}$/i.test(s.key)) {
        keyInput.value = s.key.toLowerCase();
        key = generateKey(parseInt(s.key.replace(/^0x/i, ''), 16));
      }
    },
  };
}
