/**
 * Act 2 -- a difference that never happens, and the break-it-yourself control.
 *
 * The reader types their own input and output difference. The page computes
 * whether the structural argument rules it out, then ENCRYPTS REAL PAIRS and
 * counts. Two outcomes, both honest:
 *
 *   predicted impossible + zero occurrences  -> the claim stands, with the count
 *                                               as its evidence
 *   predicted possible + occurrences         -> the page says how often, so the
 *                                               reader sees the contrast
 *
 * And the failure branch that makes it a test rather than a demo: if a
 * predicted-impossible difference EVER occurs, the page withdraws the claim and
 * says so (E_NOT_IMPOSSIBLE). It has never fired, and the mutation check in the
 * claims suite is what proves the branch is live rather than decorative.
 */
import { compute } from './compute.ts';
import type { ImpossibleResult } from '../crypto/jobs.ts';
import { FAILURE_CODES, FAILURE_TEXT } from '../crypto/failures.ts';
import type { SboxName } from '../crypto/sbox.ts';
import { getSbox } from '../crypto/sbox.ts';
import { tablesFor } from '../crypto/tables.ts';
import { bestSplit } from '../crypto/trails.ts';
import { MASTER_KEY_SPACE } from '../crypto/experiments.ts';
import {
  callout,
  clear,
  disclosure,
  el,
  field,
  hex8,
  num,
  parseByte,
  scrollRegion,
  stat,
  verdict,
} from './dom.ts';

export interface ImpossiblePanel {
  readonly node: HTMLElement;
  run(sbox: SboxName): Promise<void>;
}

const DEFAULT_ALPHA = 0x0a;
const DEFAULT_DELTA = 0x01;
const ROUNDS = 3;

const KEY_CHOICES = [
  { value: 256, label: '256 keys' },
  { value: 4096, label: '4 096 keys' },
  { value: 65536, label: 'all 65 536 keys (exhaustive)' },
];

/** The middle sets, side by side, with the empty overlap as the exhibit. */
function certificate(sbox: SboxName, alpha: number, delta: number): HTMLElement {
  const { ddt } = tablesFor(getSbox(sbox));
  const m = bestSplit(ddt, alpha, delta, ROUNDS);
  const wrap = el('div', {});
  wrap.append(
    el('p', {}, [
      document.createTextNode(
        `Split the ${ROUNDS} rounds into ${m.forwardLayers} forward and ${m.backwardLayers} backward. Push ${hex8(alpha)} forward through ${m.forwardLayers} round${m.forwardLayers === 1 ? '' : 's'} and list every difference it can possibly reach. Pull ${hex8(delta)} backward through ${m.backwardLayers} and list every difference that could possibly produce it. Both lists are complete -- not samples -- so each is a statement that holds with probability 1.`
      ),
    ])
  );
  const shared = m.shared;
  wrap.append(
    el('div', { class: 'readout' }, [
      stat(
        `forward from ${hex8(alpha)}`,
        `${m.forward.length} difference${m.forward.length === 1 ? '' : 's'}`,
        m.forward.length <= 12 ? m.forward.map(hex8).join('  ') : `${m.forward.slice(0, 8).map(hex8).join('  ')} ...`,
        'accent'
      ),
      stat(
        `backward from ${hex8(delta)}`,
        `${m.backward.length} difference${m.backward.length === 1 ? '' : 's'}`,
        m.backward.length <= 12 ? m.backward.map(hex8).join('  ') : `${m.backward.slice(0, 8).map(hex8).join('  ')} ...`,
        'accent'
      ),
      stat(
        'in both lists',
        shared.length === 0 ? 'none' : `${shared.length}`,
        shared.length === 0
          ? 'the two halves cannot meet'
          : `e.g. ${shared.slice(0, 6).map(hex8).join('  ')}`,
        shared.length === 0 ? 'good' : 'warn'
      ),
    ])
  );
  if (m.forward.length <= 40) {
    const back = new Set(m.backward);
    wrap.append(
      el('p', { class: 'field-hint' }, [
        document.createTextNode(
          'The complete forward list, with each entry marked for whether the backward half accepts it:'
        ),
      ])
    );
    wrap.append(
      el(
        'ul',
        { class: 'nibble-row', role: 'list', 'aria-label': 'forward-reachable middle differences' },
        m.forward.map((v) =>
          el('li', { class: `nibble ${back.has(v) ? 'nibble-on' : 'nibble-off'}`, role: 'listitem' }, [
            document.createTextNode(hex8(v)),
            el('span', { class: 'sr-only', text: back.has(v) ? ' in both lists' : ' forward only' }),
          ])
        )
      )
    );
  }
  return wrap;
}

export function impossiblePanel(): ImpossiblePanel {
  const alphaInput = el('input', {
    type: 'text',
    id: 'imp-alpha',
    value: hex8(DEFAULT_ALPHA),
    inputmode: 'text',
    maxlength: '4',
    spellcheck: 'false',
    autocomplete: 'off',
  });
  const deltaInput = el('input', {
    type: 'text',
    id: 'imp-delta',
    value: hex8(DEFAULT_DELTA),
    inputmode: 'text',
    maxlength: '4',
    spellcheck: 'false',
    autocomplete: 'off',
  });
  const keySelect = el('select', { id: 'imp-keys' });
  for (const c of KEY_CHOICES) keySelect.append(el('option', { value: String(c.value), text: c.label }));
  keySelect.value = '256';

  const runBtn = el('button', { class: 'btn btn-primary', type: 'button', id: 'imp-run' }, [
    document.createTextNode('Try to make it happen'),
  ]);

  const out = el('div', { id: 'imp-out', role: 'status', 'aria-live': 'polite' }, [
    el('p', { class: 'field-hint', text: 'Measuring...' }),
  ]);

  let currentSbox: SboxName = 'weak';
  /**
   * What produced the result currently on screen. A verdict that outlives its
   * inputs is the worst kind of wrong: it looks like an answer to the question
   * the reader is now asking. So the panel remembers the exact inputs behind the
   * rendered verdict and RETIRES it the moment any of them changes, naming which
   * one. Re-entering the SAME value is not a change and must not retire a fresh
   * verdict -- both halves are asserted in `e2e/claims.spec.ts`.
   */
  let shown: { alpha: string; delta: string; keys: string; sbox: SboxName } | null = null;

  function currentInputs(): { alpha: string; delta: string; keys: string; sbox: SboxName } {
    return {
      alpha: alphaInput.value.trim().toLowerCase(),
      delta: deltaInput.value.trim().toLowerCase(),
      keys: keySelect.value,
      sbox: currentSbox,
    };
  }

  function retireIfStale(): void {
    if (!shown) return;
    const now = currentInputs();
    const changed: string[] = [];
    if (now.alpha !== shown.alpha) changed.push('the input difference');
    if (now.delta !== shown.delta) changed.push('the output difference');
    if (now.keys !== shown.keys) changed.push('the key count');
    if (now.sbox !== shown.sbox) changed.push('the substitution table');
    if (changed.length === 0) return;
    shown = null;
    clear(out);
    out.append(
      verdict(
        'info',
        'VERDICT RETIRED',
        `${changed.join(' and ')} changed, so the result that was here no longer answers the question on screen. Press "Try to make it happen" to measure the new one.`,
        'imp-retired'
      )
    );
  }

  function fail(code: string): void {
    shown = null;
    clear(out);
    out.append(
      verdict('fail', `NOT RUN — ${code}`, FAILURE_TEXT[code as keyof typeof FAILURE_TEXT], 'imp-failure')
    );
  }

  async function run(sbox: SboxName): Promise<void> {
    currentSbox = sbox;
    const alpha = parseByte(alphaInput.value);
    const delta = parseByte(deltaInput.value);
    alphaInput.setAttribute('aria-invalid', alpha === null || alpha === 0 ? 'true' : 'false');
    deltaInput.setAttribute('aria-invalid', delta === null || delta === 0 ? 'true' : 'false');
    if (alpha === null || delta === null) {
      fail(FAILURE_CODES.RANGE);
      return;
    }
    if (alpha === 0) {
      fail(FAILURE_CODES.ALPHA_ZERO);
      return;
    }
    if (delta === 0) {
      fail(FAILURE_CODES.DELTA_ZERO);
      return;
    }
    const keyCount = Number(keySelect.value);
    runBtn.disabled = true;
    runBtn.textContent = 'Encrypting...';
    clear(out);
    out.append(
      el('p', {
        class: 'field-hint',
        text: `Encrypting ${num(keyCount * 128)} pairs under ${num(keyCount)} keys...`,
      })
    );
    const result = (await compute({
      kind: 'impossible',
      sbox,
      alpha,
      delta,
      rounds: ROUNDS,
      keyCount,
      seed: 424242,
    })) as ImpossibleResult;
    render(result);
    shown = currentInputs();
    runBtn.disabled = false;
    runBtn.textContent = 'Try to make it happen';
  }

  function render(r: ImpossibleResult): void {
    clear(out);

    out.append(
      el('div', { class: 'readout' }, [
        stat('pairs encrypted', num(r.pairs), `${num(r.keysUsed)} keys x 128 pairs`, 'accent'),
        stat(
          `times ${hex8(r.delta)} appeared`,
          num(r.occurrences),
          r.predictedImpossible ? 'predicted: never' : 'predicted: reachable',
          r.predictedImpossible ? (r.occurrences === 0 ? 'good' : 'bad') : undefined
        ),
        stat(
          'differences ruled out',
          `${r.impossibleDiffs.length} of 255`,
          `from input difference ${hex8(r.alpha)}, over ${r.rounds} rounds`
        ),
        stat(
          'prediction tight?',
          r.observedDistinct === r.predictedReachable ? 'exactly' : `${r.observedDistinct} of ${r.predictedReachable} seen`,
          'reachable differences that actually occurred',
          r.observedDistinct === r.predictedReachable ? 'good' : undefined
        ),
      ])
    );

    if (r.predictedImpossible && r.occurrences === 0) {
      out.append(
        verdict(
          'pass',
          r.exhaustiveOverKeys ? 'IMPOSSIBLE — PROVEN BY EXHAUSTION' : 'IMPOSSIBLE — NOT ONCE',
          `${hex8(r.alpha)} never produced ${hex8(r.delta)} across ${num(r.pairs)} encrypted pairs under ${num(r.keysUsed)} ${r.exhaustiveOverKeys ? 'keys -- every key this cipher has' : 'sampled keys'}. Not rare. Zero.`,
          'imp-verdict'
        )
      );
    } else if (r.predictedImpossible) {
      out.append(
        verdict(
          'fail',
          `CLAIM WITHDRAWN — ${FAILURE_CODES.NOT_IMPOSSIBLE}`,
          `${FAILURE_TEXT[FAILURE_CODES.NOT_IMPOSSIBLE]} It occurred ${num(r.occurrences)} times in ${num(r.pairs)} pairs.`,
          'imp-verdict'
        )
      );
    } else {
      out.append(
        verdict(
          'info',
          'POSSIBLE — AND IT HAPPENED',
          `${hex8(r.alpha)} -> ${hex8(r.delta)} is reachable, and turned up ${num(r.occurrences)} times in ${num(r.pairs)} pairs (about 1 in ${r.occurrences > 0 ? Math.round(r.pairs / r.occurrences) : 0}). Nothing is proven by a difference that merely can happen; try one of the ruled-out differences below.`,
          'imp-verdict'
        )
      );
    }

    if (r.impossibleDiffs.length > 0) {
      const oneNibble = r.impossibleDiffs.every((d) => (((d >> 4) & 0xf) === 0) !== ((d & 0xf) === 0));
      out.append(
        el('p', {}, [
          document.createTextNode(
            `Every difference this input can never produce after ${r.rounds} rounds${oneNibble ? ' -- which is exactly the set that leaves one of the two S-boxes quiet' : ''}:`
          ),
        ])
      );
      out.append(
        scrollRegion('Differences ruled out', 'chart-wrap', [
          el(
            'ul',
            { class: 'nibble-row', role: 'list', 'aria-label': 'ruled-out output differences' },
            r.impossibleDiffs.map((d) =>
              el(
                'li',
                {
                  class: `nibble ${d === r.delta ? 'nibble-on' : 'nibble-off'}`,
                  role: 'listitem',
                },
                [document.createTextNode(hex8(d))]
              )
            )
          ),
        ])
      );
    }

    out.append(el('h3', { class: 'subhead', text: 'The miss in the middle' }));
    out.append(certificate(currentSbox, r.alpha, r.delta));

    out.append(
      callout('note', 'What covers the keys you did not test', [
        el('p', {}, [
          document.createTextNode(
            'The count above is evidence, not the proof. The proof is structural: a round key is XORed in BEFORE the substitution, so it changes which plaintexts realise a crossing and never which crossings exist. The list of impossible crossings belongs to the S-box alone, so the two middle lists above -- and their empty overlap -- are the same for all '
          ),
          el('code', { text: num(MASTER_KEY_SPACE) }),
          document.createTextNode(
            ' keys, including every key no enumeration here ever touched. The enumeration is what would catch the argument being wrong.'
          ),
        ]),
      ])
    );

    out.append(
      disclosure('The honest scope of this act', [
        el('p', {}, [
          document.createTextNode(
            'This impossible differential covers THREE rounds, not four. Run the same computation on the full four-round cipher and every one of the 255 nonzero output differences turns out to be reachable from every input difference: there is no four-round impossible differential to find. That is not a gap in the search -- it is the result, and it is why Act 3 uses the three-round property to attack the last round of the four-round cipher rather than distinguishing the whole thing.'
          ),
        ]),
        el('p', {}, [
          document.createTextNode(
            'Exhausting the key space is a luxury of an 8-bit block. For a real cipher the enumeration is impossible and the structural argument is all there is, which is why Biham, Biryukov and Shamir argue their 24-round Skipjack impossible differential structurally rather than by counting.'
          ),
        ]),
      ])
    );
  }

  const node = el('section', { class: 'card', 'aria-labelledby': 'act2-title', id: 'act2' }, [
    el('div', { class: 'act-head' }, [
      el('span', { class: 'act-num', text: 'ACT 2' }),
      el('h2', { class: 'act-title', id: 'act2-title', text: 'A difference that never happens' }),
    ]),
    el('p', { class: 'act-lede' }, [
      document.createTextNode(
        'Turn the tool around. Instead of hunting for a difference that is likely, find one whose probability is exactly zero -- then use it to eliminate wrong keys. Push a difference forward as far as certainty allows, pull the target backward the same way, and if the two halves cannot meet, the pair can never exist. Type any two differences and try to make it happen.'
      ),
    ]),
    el('div', { class: 'controls' }, [
      field('Input difference', alphaInput, 'hex byte, e.g. 0a'),
      field('Output difference after 3 rounds', deltaInput, 'hex byte, e.g. 01'),
      field('Keys sampled', keySelect),
      el('div', { class: 'field' }, [
        el('span', { class: 'group-label', 'aria-hidden': 'true', text: ' ' }),
        runBtn,
      ]),
    ]),
    out,
  ]);

  runBtn.addEventListener('click', () => {
    void run(currentSbox);
  });
  for (const input of [alphaInput, deltaInput]) {
    input.addEventListener('input', retireIfStale);
    input.addEventListener('keydown', (e) => {
      if ((e as KeyboardEvent).key === 'Enter') void run(currentSbox);
    });
  }
  keySelect.addEventListener('change', retireIfStale);

  return { node, run };
}
