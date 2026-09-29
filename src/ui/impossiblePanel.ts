/**
 * Act 2 -- a difference that never happens, and the break-it-yourself control.
 *
 * The reader types their own differences. The page computes whether the
 * structural argument rules the pair out, then ENCRYPTS REAL PAIRS and counts.
 * The structural argument leads, as a diagram; the enumeration follows it as
 * evidence, because the enumeration is what would catch the argument being
 * wrong, not what makes it true.
 *
 * The failure branch is what makes it a test rather than a demo: if a
 * predicted-impossible difference ever occurs, the page withdraws the claim
 * (E_NOT_IMPOSSIBLE). It has never fired; the mutation check in the claims suite
 * is what proves the branch is live.
 */
import { compute } from './compute.ts';
import type { ImpossibleResult } from '../crypto/jobs.ts';
import { FAILURE_CODES, FAILURE_TEXT } from '../crypto/failures.ts';
import type { SboxName } from '../crypto/sbox.ts';
import { getSbox } from '../crypto/sbox.ts';
import { tablesFor } from '../crypto/tables.ts';
import { bestSplit } from '../crypto/trails.ts';
import { MASTER_KEY_SPACE } from '../crypto/experiments.ts';
import { missInTheMiddleDiagram } from './diagrams.ts';
import { PanelRunner } from './panel.ts';
import { setBusy } from './latest.ts';
import {
  callout,
  clear,
  disclosure,
  el,
  field,
  hex8,
  markRun,
  num,
  parseByte,
  scrollRegion,
  stat,
  verdict,
} from './dom.ts';

export interface ImpossiblePanel {
  readonly node: HTMLElement;
  run(sbox: SboxName): Promise<void>;
  reset(sbox: SboxName): Promise<void>;
  state(): { alpha: string; delta: string; keys: string; rounds: string };
  restore(s: Partial<{ alpha: string; delta: string; keys: string; rounds: string }>): void;
}

const DEFAULTS = { alpha: '0x0a', delta: '0x01', keys: '256', rounds: '3' };

const KEY_CHOICES = [
  { value: 256, label: '256 keys' },
  { value: 4096, label: '4 096 keys' },
  { value: 65536, label: 'all 65 536 keys (exhaustive)' },
];

export function impossiblePanel(): ImpossiblePanel {
  const runner = new PanelRunner<{ alpha: string; delta: string; keys: string; rounds: string; sbox: SboxName }>(
    'imp-out',
    'Act 2 results: is this differential impossible?'
  );

  const mk = (id: string, value: string): HTMLInputElement =>
    el('input', {
      type: 'text',
      id,
      value,
      inputmode: 'text',
      maxlength: '4',
      spellcheck: 'false',
      autocomplete: 'off',
    }) as HTMLInputElement;

  const alphaInput = mk('imp-alpha', DEFAULTS.alpha);
  const deltaInput = mk('imp-delta', DEFAULTS.delta);

  const roundSelect = el('select', { id: 'imp-rounds' });
  for (const r of [2, 3, 4]) {
    roundSelect.append(el('option', { value: String(r), text: `${r} rounds` }));
  }
  roundSelect.value = DEFAULTS.rounds;

  const keySelect = el('select', { id: 'imp-keys' });
  for (const c of KEY_CHOICES) keySelect.append(el('option', { value: String(c.value), text: c.label }));
  keySelect.value = DEFAULTS.keys;

  const runBtn = el('button', { class: 'btn btn-primary', type: 'button', id: 'imp-run' }, [
    document.createTextNode('Try to make it happen'),
  ]) as HTMLButtonElement;
  runner.manage(runBtn);

  let currentSbox: SboxName = 'weak';
  /** The inputs behind the result currently on screen, so a change can retire it. */
  let shown: { alpha: string; delta: string; keys: string; rounds: string; sbox: SboxName } | null = null;

  function inputs(): { alpha: string; delta: string; keys: string; rounds: string; sbox: SboxName } {
    return {
      alpha: alphaInput.value.trim().toLowerCase(),
      delta: deltaInput.value.trim().toLowerCase(),
      keys: keySelect.value,
      rounds: roundSelect.value,
      sbox: currentSbox,
    };
  }

  /**
   * A verdict that outlives its inputs is the worst kind of wrong: it looks like
   * an answer to the question now on screen. Re-entering the SAME value is not a
   * change and must not retire a fresh verdict; both halves are asserted in the
   * claims suite.
   */
  function retireIfStale(): void {
    if (!shown) return;
    const now = inputs();
    const changed: string[] = [];
    if (now.alpha !== shown.alpha) changed.push('the input difference');
    if (now.delta !== shown.delta) changed.push('the output difference');
    if (now.keys !== shown.keys) changed.push('the key count');
    if (now.rounds !== shown.rounds) changed.push('the round count');
    if (now.sbox !== shown.sbox) changed.push('the substitution table');
    if (changed.length === 0) return;
    shown = null;
    clear(runner.out);
    runner.out.append(
      verdict(
        'info',
        'VERDICT RETIRED',
        `${changed.join(' and ')} changed, so the result that was here no longer answers the question on screen. Press “Try to make it happen” to measure the new one.`,
        'imp-retired'
      )
    );
    runner.announce.textContent = 'Verdict retired: the inputs changed.';
    runner.meta.textContent = '';
    setBusy(runner.out, false);
    markRun(runner.out);
  }

  function fail(code: string): void {
    shown = null;
    clear(runner.out);
    runner.out.append(
      verdict('fail', `NOT RUN — ${code}`, FAILURE_TEXT[code as keyof typeof FAILURE_TEXT], 'imp-failure')
    );
    runner.announce.textContent = `Not run: ${code}.`;
    runner.meta.textContent = '';
    setBusy(runner.out, false);
    markRun(runner.out);
  }

  async function run(sbox: SboxName): Promise<void> {
    currentSbox = sbox;
    const alpha = parseByte(alphaInput.value);
    const delta = parseByte(deltaInput.value);
    alphaInput.setAttribute('aria-invalid', alpha === null || alpha === 0 ? 'true' : 'false');
    deltaInput.setAttribute('aria-invalid', delta === null || delta === 0 ? 'true' : 'false');
    if (alpha === null || delta === null) return fail(FAILURE_CODES.RANGE);
    if (alpha === 0) return fail(FAILURE_CODES.ALPHA_ZERO);
    if (delta === 0) return fail(FAILURE_CODES.DELTA_ZERO);

    const keyCount = Number(keySelect.value);
    const rounds = Number(roundSelect.value);
    const snapshot = inputs();
    await runner.run(
      snapshot,
      `Encrypting ${num(keyCount * 128)} pairs under ${num(keyCount)} keys…`,
      () =>
        compute({
          kind: 'impossible',
          sbox,
          alpha,
          delta,
          rounds,
          keyCount,
          seed: 424242,
        }) as Promise<ImpossibleResult>,
      (result) => {
        shown = snapshot;
        return render(result);
      }
    );
  }

  function render(r: ImpossibleResult): string {
    const out = runner.out;
    const { ddt } = tablesFor(getSbox(currentSbox));
    const m = bestSplit(ddt, r.alpha, r.delta, r.rounds);

    // The structural argument first, as a picture. The count is evidence for it,
    // not the thing itself.
    out.append(missInTheMiddleDiagram(m));

    if (r.predictedImpossible && r.occurrences === 0) {
      out.append(
        verdict(
          'pass',
          r.exhaustiveOverKeys ? 'IMPOSSIBLE — PROVEN BY EXHAUSTION' : 'IMPOSSIBLE — NOT ONCE',
          `${hex8(r.alpha)} never produced ${hex8(r.delta)} across ${num(r.pairs)} encrypted pairs under ${num(r.keysUsed)} ${r.exhaustiveOverKeys ? 'keys — every key this cipher has' : 'sampled keys'}. Not rare. Zero.`,
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
          `${hex8(r.alpha)} → ${hex8(r.delta)} is reachable, and turned up ${num(r.occurrences)} times in ${num(r.pairs)} pairs. Nothing is proven by a difference that merely can happen \u2014 try a ruled-out one below.`,
          'imp-verdict'
        )
      );
    }

    out.append(
      el('div', { class: 'readout' }, [
        stat('pairs encrypted', num(r.pairs), `${num(r.keysUsed)} keys × 128 pairs`, 'accent'),
        stat(
          `times ${hex8(r.delta)} appeared`,
          num(r.occurrences),
          r.predictedImpossible ? 'predicted: never' : 'predicted: reachable',
          r.predictedImpossible ? (r.occurrences === 0 ? 'good' : 'bad') : undefined
        ),
        stat(
          'differences ruled out',
          `${r.impossibleDiffs.length} of 255`,
          `from ${hex8(r.alpha)}, over ${r.rounds} rounds`
        ),
        stat(
          'prediction tight?',
          r.observedDistinct === r.predictedReachable ? 'exactly' : `${r.observedDistinct} of ${r.predictedReachable}`,
          'reachable differences that really occurred',
          r.observedDistinct === r.predictedReachable ? 'good' : undefined
        ),
      ])
    );

    if (r.impossibleDiffs.length > 0) {
      const oneNibble = r.impossibleDiffs.every((d) => (((d >> 4) & 0xf) === 0) !== ((d & 0xf) === 0));
      out.append(
        el('p', { class: 'field-hint' }, [
          document.createTextNode(
            `Every difference ${hex8(r.alpha)} can never produce after ${r.rounds} rounds${oneNibble ? ' — exactly the set that leaves one of the two S-boxes quiet' : ''}:`
          ),
        ])
      );
      out.append(
        scrollRegion('Differences ruled out', 'chart-wrap', [
          el(
            'ul',
            { class: 'chipset', role: 'list', 'aria-label': 'ruled-out output differences' },
            r.impossibleDiffs.map((d) =>
              el(
                'li',
                { class: `chip-val${d === r.delta ? ' nibble-on' : ''}`, role: 'listitem' },
                [document.createTextNode(hex8(d))]
              )
            )
          ),
        ])
      );
    }

    out.append(
      callout('note', 'What covers the keys you did not test', [
        el('p', {}, [
          document.createTextNode(
            'The count is evidence, not the proof. A round key is XORed in BEFORE the substitution, so it changes which plaintexts realise a crossing, never which crossings exist. The two lists above are the same for all '
          ),
          el('code', { text: num(MASTER_KEY_SPACE) }),
          document.createTextNode(' keys — including every key no enumeration here ever touched.'),
        ]),
      ])
    );

    out.append(
      disclosure('Inspect the evidence: the honest scope of this act', [
        el('p', {}, [
          document.createTextNode(
            'Set the round count to 4 and every one of the 255 nonzero output differences turns out reachable from every input difference: there is no four-round impossible differential to find. That is the result, not a gap in the search, and it is why Act 3 uses the three-round property against the last round rather than distinguishing the whole cipher.'
          ),
        ]),
        el('p', {}, [
          document.createTextNode(
            'Exhausting the key space is a luxury of an 8-bit block. For a real cipher the enumeration is out of reach and the structural argument is all there is — which is why Biham, Biryukov and Shamir argue their 24-round Skipjack impossible differential structurally rather than by counting.'
          ),
        ]),
      ])
    );

    return r.predictedImpossible
      ? `Measurement complete: ${num(r.occurrences)} occurrences in ${num(r.pairs)} pairs. ${r.occurrences === 0 ? 'The differential is impossible.' : 'The impossibility claim was withdrawn.'}`
      : `Measurement complete: ${num(r.occurrences)} occurrences in ${num(r.pairs)} pairs. The differential is possible.`;
  }

  const node = el('section', { class: 'card', 'aria-labelledby': 'act2-title', id: 'act2' }, [
    el('div', { class: 'act-head' }, [
      el('span', { class: 'act-num', text: 'ACT 2' }),
      el('h2', { class: 'act-title', id: 'act2-title', text: 'A difference that never happens' }),
    ]),
    el('p', { class: 'act-lede' }, [
      document.createTextNode(
        'Instead of a difference that is likely, find one whose probability is exactly zero. Push the input forward as far as certainty allows, pull the target backward the same way \u2014 if the halves cannot meet, the pair can never exist. Type any two and try.'
      ),
    ]),
    el('div', { class: 'controls' }, [
      field('Input difference', alphaInput, 'hex byte'),
      field('Output difference', deltaInput, 'hex byte'),
      field('Rounds', roundSelect),
      field('Keys sampled', keySelect),
      el('div', { class: 'field' }, [
        el('span', { class: 'group-label', 'aria-hidden': 'true', text: ' ' }),
        runBtn,
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
  for (const input of [alphaInput, deltaInput]) {
    input.addEventListener('input', retireIfStale);
    input.addEventListener('keydown', (e) => {
      if ((e as KeyboardEvent).key === 'Enter') void run(currentSbox);
    });
  }
  keySelect.addEventListener('change', retireIfStale);
  roundSelect.addEventListener('change', retireIfStale);

  return {
    node,
    run,
    async reset(sbox: SboxName) {
      currentSbox = sbox;
      alphaInput.value = DEFAULTS.alpha;
      deltaInput.value = DEFAULTS.delta;
      keySelect.value = DEFAULTS.keys;
      roundSelect.value = DEFAULTS.rounds;
      await run(sbox);
    },
    state: () => ({
      alpha: alphaInput.value,
      delta: deltaInput.value,
      keys: keySelect.value,
      rounds: roundSelect.value,
    }),
    restore(s) {
      if (s.alpha) alphaInput.value = s.alpha;
      if (s.delta) deltaInput.value = s.delta;
      if (s.keys && KEY_CHOICES.some((c) => String(c.value) === s.keys)) keySelect.value = s.keys;
      if (s.rounds && ['2', '3', '4'].includes(s.rounds)) roundSelect.value = s.rounds;
    },
  };
}
