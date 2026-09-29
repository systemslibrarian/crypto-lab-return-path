/**
 * Act 1 -- why one trail is not enough.
 *
 * Three quantities per round count, and the act is the gap between them:
 *   TRAIL         the product of DDT entries along the single best path.
 *   DIFFERENTIAL  the sum over EVERY path with the same two endpoints.
 *   MEASURED      what the cipher actually does, over real encryptions.
 *
 * The chart tracks the BEST TRAIL's endpoint pair, and says so. The best
 * DIFFERENTIAL is a different endpoint pair from four rounds on, which the page
 * reports separately rather than letting one word stand for two quantities.
 */
import { compute } from './compute.ts';
import type { DecayResult, DecayRow } from '../crypto/jobs.ts';
import type { SboxName } from '../crypto/sbox.ts';
import { MAX_ROUNDS, PAIRS_PER_CODEBOOK } from '../crypto/spn.ts';
import { legend, lineChart } from './chart.ts';
import { PanelRunner } from './panel.ts';
import {
  disclosure,
  el,
  field,
  hex8,
  log2Label,
  num,
  scrollRegion,
  stat,
  verdict,
} from './dom.ts';

export interface DecayPanel {
  readonly node: HTMLElement;
  run(sbox: SboxName): Promise<void>;
  reset(sbox: SboxName): Promise<void>;
}

const KEY_CHOICES = [
  { value: 256, label: '256 keys (32 768 pairs)' },
  { value: 2048, label: '2 048 keys (262 144 pairs)' },
  { value: 16384, label: '16 384 keys (2.1 M pairs)' },
  { value: 65536, label: 'all 65 536 keys (exhaustive)' },
];
const DEFAULT_KEYS = '256';

function rowsTable(rows: readonly DecayRow[]): HTMLElement {
  return scrollRegion('Predicted and measured probability by round count', 'table-wrap', [
    el('table', {}, [
      el('caption', {
        text: 'Probabilities as powers of two. The first three columns are the best trail’s endpoint pair; the last is the best differential, which is a different pair from four rounds on.',
      }),
      el('thead', {}, [
        el('tr', {}, [
          el('th', { scope: 'col', text: 'R' }),
          el('th', { scope: 'col', text: 'alpha' }),
          el('th', { scope: 'col', text: 'delta' }),
          el('th', { scope: 'col', text: 'trail' }),
          el('th', { scope: 'col', text: 'differential' }),
          el('th', { scope: 'col', text: 'measured' }),
          el('th', { scope: 'col', text: 'right pairs' }),
          el('th', { scope: 'col', text: 'pairs tested' }),
          el('th', { scope: 'col', text: 'best differential' }),
        ]),
      ]),
      el(
        'tbody',
        {},
        rows.map((r) =>
          el('tr', {}, [
            el('th', { scope: 'row', text: String(r.rounds) }),
            el('td', { text: hex8(r.alpha) }),
            el('td', { text: hex8(r.delta) }),
            el('td', { text: log2Label(r.trailPrediction) }),
            el('td', { text: log2Label(r.differentialPrediction) }),
            el('td', { text: log2Label(r.measured) }),
            el('td', { text: r.measuredRightPairs.toFixed(2) }),
            el('td', { text: num(r.pairs) }),
            el('td', {
              text: r.sameEndpoints
                ? 'same pair'
                : `${hex8(r.bestDiffAlpha)}→${hex8(r.bestDiffDelta)} ${log2Label(r.bestDiffPrediction)}`,
            }),
          ])
        )
      ),
    ]),
  ]);
}

export function decayPanel(): DecayPanel {
  const runner = new PanelRunner<{ sbox: SboxName; keys: string }>(
    'decay-out',
    'Act 1 results: trail decay by round count'
  );

  const keySelect = el('select', { id: 'decay-keys' });
  for (const c of KEY_CHOICES) {
    keySelect.append(el('option', { value: String(c.value), text: c.label }));
  }
  keySelect.value = DEFAULT_KEYS;

  const runBtn = el('button', { class: 'btn btn-primary', type: 'button', id: 'decay-run' }, [
    document.createTextNode('Measure the decay'),
  ]) as HTMLButtonElement;
  runner.manage(runBtn);

  let currentSbox: SboxName = 'weak';

  async function run(sbox: SboxName): Promise<void> {
    currentSbox = sbox;
    const keyCount = Number(keySelect.value);
    await runner.run(
      { sbox, keys: keySelect.value },
      `Encrypting ${num(keyCount * PAIRS_PER_CODEBOOK)} pairs per round count…`,
      () =>
        compute({
          kind: 'decay',
          sbox,
          maxRounds: MAX_ROUNDS,
          keyCount,
          seed: 20260929,
        }) as Promise<DecayResult>,
      (result) => render(result)
    );
  }

  function render(result: DecayResult): string {
    const rows = result.rows;
    const last = rows[rows.length - 1];
    const firstBelowOne = rows.find((r) => r.measuredRightPairs < 1);
    const trailError = last.measured / last.trailPrediction;
    const out = runner.out;

    out.append(
      el('div', { class: 'readout' }, [
        stat(
          'best trail at 6 rounds',
          log2Label(last.trailPrediction),
          `${hex8(last.alpha)} → ${hex8(last.delta)}`,
          'warn'
        ),
        stat('every trail between those two, summed', log2Label(last.differentialPrediction), 'the differential'),
        stat(
          'measured',
          log2Label(last.measured),
          `95% ${last.ci[0].toExponential(2)}–${last.ci[1].toExponential(2)}, ${num(last.pairs)} pairs`,
          'accent'
        ),
        stat('single-trail error', `${trailError.toFixed(1)}× too low`, 'measured ÷ trail', 'bad'),
      ])
    );

    const yMin = -13;
    const threshold = rows.find((r) => r.measuredRightPairs < 1);
    out.append(
      lineChart({
        title: `Probability of the best trail's endpoint pair, by round count: the single trail, every trail summed, and the measured rate`,
        xLabels: rows.map((r) => String(r.rounds)),
        xTitle: 'rounds',
        yTitle: 'log2 probability',
        yMin,
        yMax: 0,
        rules: [{ at: -8, label: 'random permutation', colorVar: '--series-null' }],
        marker: threshold
          ? {
              atIndex: threshold.rounds - 1,
              label: `${threshold.rounds} rounds: fewer than one right pair in the whole codebook`,
              colorVar: '--bad',
            }
          : undefined,
        series: [
          {
            label: 'single best trail',
            colorVar: '--series-trail',
            dash: '7 4',
            marker: 'diamond',
            points: rows.map((r) => Math.log2(r.trailPrediction)),
          },
          {
            label: 'every trail summed',
            colorVar: '--series-differential',
            dash: '2 3',
            marker: 'square',
            points: rows.map((r) => Math.log2(r.differentialPrediction)),
          },
          {
            label: 'measured',
            colorVar: '--series-measured',
            dash: 'none',
            marker: 'circle',
            points: rows.map((r) => (r.measured > 0 ? Math.log2(r.measured) : null)),
          },
        ],
      })
    );
    out.append(
      legend([
        { label: 'single best trail', colorVar: '--series-trail', dash: 'dash' },
        { label: 'every trail summed', colorVar: '--series-differential', dash: 'dash' },
        { label: 'measured', colorVar: '--series-measured', dash: 'none' },
        { label: 'random permutation', colorVar: '--series-null', dash: 'dash' },
      ])
    );

    out.append(
      verdict(
        'alarm',
        firstBelowOne
          ? `THE TRAIL RUNS OUT AT ${firstBelowOne.rounds} ROUNDS`
          : 'THE TRAIL SURVIVES EVERY ROUND COUNT TESTED',
        firstBelowOne
          ? `Buy the entire 256-plaintext codebook at ${firstBelowOne.rounds} rounds and you get ${firstBelowOne.measuredRightPairs.toFixed(2)} right pairs. Fewer than one. A random permutation hands you ${result.randomRightPairs.toFixed(2)}.`
          : 'Every round count tested still yields at least one right pair in the full codebook.'
      )
    );

    out.append(
      verdict(
        'fail',
        'AND THE SINGLE-TRAIL PREDICTION IS WRONG',
        `At 6 rounds the best single trail predicts ${log2Label(last.trailPrediction)}; the cipher delivers ${log2Label(last.measured)}, ${trailError.toFixed(1)} times more often. A differential is the SUM over every trail between those endpoints — add them and the prediction lands within ${Math.abs(Math.log2(last.measured) - Math.log2(last.differentialPrediction)).toFixed(2)} bits.`
      )
    );

    const diverge = rows.filter((r) => !r.sameEndpoints);
    if (diverge.length > 0) {
      const first = diverge[0];
      out.append(
        verdict(
          'info',
          `AND FROM ${first.rounds} ROUNDS THE BEST TRAIL DOES NOT EVEN POINT AT THE BEST DIFFERENTIAL`,
          `At ${first.rounds} rounds the strongest trail runs ${hex8(first.alpha)} → ${hex8(first.delta)}, but the strongest differential is ${hex8(first.bestDiffAlpha)} → ${hex8(first.bestDiffDelta)} at ${log2Label(first.bestDiffPrediction)} — a different pair, found by exhausting all 65 025 of them. Searching for trails does not find it.`
        )
      );
    }

    out.append(
      disclosure('Inspect the evidence: every round, both endpoint pairs', [
        rowsTable(rows),
        el('p', {}, [
          document.createTextNode(
            'A trail fixes the difference after every round; a differential fixes only the two ends. At one round there is exactly one path between any two differences, so they agree. Every extra round multiplies the paths, and this permutation sends two bits of each S-box into each S-box of the next round.'
          ),
        ]),
        el('p', {}, [
          document.createTextNode(
            'The measured value is not identical to the summed prediction either. The sum assumes independent round keys; this schedule repeats every four rounds, so they are not. The residual gap is that assumption failing, and it is small here. Intervals are a cluster bootstrap over keys, not over pairs — the 128 pairs one key contributes are not 128 independent trials.'
          ),
        ]),
      ])
    );

    return `Trail decay measured over ${num(last.pairs)} pairs per round count. At six rounds the single-trail prediction is ${trailError.toFixed(1)} times too low.`;
  }

  const node = el('section', { class: 'card', 'aria-labelledby': 'act1-title', id: 'act1' }, [
    el('div', { class: 'act-head' }, [
      el('span', { class: 'act-num', text: 'ACT 1' }),
      el('h2', { class: 'act-title', id: 'act1-title', text: 'One trail is not enough' }),
    ]),
    el('p', { class: 'act-lede' }, [
      document.createTextNode(
        'Classical differential cryptanalysis needs one high-probability path through the whole cipher. Add rounds and it decays until fewer than one pair in the entire codebook follows it.'
      ),
    ]),
    el('div', { class: 'controls' }, [
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

  return {
    node,
    run,
    async reset(sbox: SboxName) {
      currentSbox = sbox;
      keySelect.value = DEFAULT_KEYS;
      await run(sbox);
    },
  };
}
