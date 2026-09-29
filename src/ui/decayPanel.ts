/**
 * Act 1 -- why one trail is not enough.
 *
 * Three quantities per round count, and the whole act is the gap between them:
 *   TRAIL         the product of DDT entries along the single best path. What a
 *                 cryptanalyst quotes as "p".
 *   DIFFERENTIAL  the sum over EVERY path with the same two endpoints. The real
 *                 probability under the standard independent-round-key model.
 *   MEASURED      what the cipher actually does, over real encryptions.
 *
 * The teaching point is not that the trail decays -- it is that the trail's
 * PREDICTION goes wrong while the differential's does not, and by six rounds the
 * single trail is out by a factor of ten. That is shown by measurement, not
 * asserted.
 */
import { compute } from './compute.ts';
import type { DecayResult, DecayRow } from '../crypto/jobs.ts';
import type { SboxName } from '../crypto/sbox.ts';
import { MAX_ROUNDS, PAIRS_PER_CODEBOOK } from '../crypto/spn.ts';
import { legend, lineChart } from './chart.ts';
import {
  clear,
  disclosure,
  el,
  field,
  hex8,
  log2Label,
  markRun,
  num,
  scrollRegion,
  stat,
  verdict,
} from './dom.ts';

export interface DecayPanel {
  readonly node: HTMLElement;
  run(sbox: SboxName): Promise<void>;
}

const KEY_CHOICES = [
  { value: 256, label: '256 keys' },
  { value: 2048, label: '2 048 keys' },
  { value: 16384, label: '16 384 keys' },
  { value: 65536, label: 'all 65 536 keys (exhaustive)' },
];

function rowsTable(rows: readonly DecayRow[]): HTMLElement {
  return scrollRegion('Predicted and measured differential probability by round count', 'table-wrap', [
    el('table', {}, [
      el('caption', {
        text: 'The same numbers as the chart. Probabilities as powers of two; right pairs are out of the 128 pairs the full codebook offers.',
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
          ])
        )
      ),
    ]),
  ]);
}

export function decayPanel(): DecayPanel {
  const out = el('div', { id: 'decay-out', role: 'status', 'aria-live': 'polite', 'data-run': '0' }, [
    el('p', { class: 'field-hint', text: 'Measuring...' }),
  ]);

  const keySelect = el('select', { id: 'decay-keys' });
  for (const c of KEY_CHOICES) {
    keySelect.append(el('option', { value: String(c.value), text: c.label }));
  }
  keySelect.value = '256';

  const runBtn = el('button', { class: 'btn btn-primary', type: 'button', id: 'decay-run' }, [
    document.createTextNode('Measure the decay'),
  ]);

  let currentSbox: SboxName = 'weak';

  async function run(sbox: SboxName): Promise<void> {
    currentSbox = sbox;
    const keyCount = Number(keySelect.value);
    runBtn.disabled = true;
    runBtn.textContent = 'Measuring...';
    clear(out);
    out.append(
      el('p', {
        class: 'field-hint',
        text: `Encrypting ${num(keyCount * PAIRS_PER_CODEBOOK)} pairs per round count...`,
      })
    );
    const result = (await compute({
      kind: 'decay',
      sbox,
      maxRounds: MAX_ROUNDS,
      keyCount,
      seed: 20260929,
    })) as DecayResult;
    render(result);
    runBtn.disabled = false;
    runBtn.textContent = 'Measure the decay';
  }

  function render(result: DecayResult): void {
    clear(out);
    const rows = result.rows;
    const last = rows[rows.length - 1];
    const firstBelowOne = rows.find((r) => r.measuredRightPairs < 1);
    const trailError = last.measured / last.trailPrediction;

    out.append(
      el('div', { class: 'readout' }, [
        stat(
          'best trail at 6 rounds',
          log2Label(last.trailPrediction),
          `${hex8(last.alpha)} -> ${hex8(last.delta)}`,
          'warn'
        ),
        stat('sum over all trails', log2Label(last.differentialPrediction), 'same two endpoints', undefined),
        stat('measured', log2Label(last.measured), `${num(last.pairs)} real pairs`, 'accent'),
        stat(
          'single-trail error',
          `${trailError.toFixed(1)}x too low`,
          'measured / trail prediction',
          'bad'
        ),
      ])
    );

    const yMin = -13;
    const yMax = 0;
    out.append(
      lineChart({
        title: `Differential probability by round count: single best trail, sum over all trails, and measured, for the ${currentSbox === 'weak' ? 'textbook' : 'PRESENT'} S-box`,
        xLabels: rows.map((r) => String(r.rounds)),
        xTitle: 'rounds',
        yTitle: 'log2 probability',
        yMin,
        yMax,
        rules: [
          { at: -8, label: 'random: 2^-8', colorVar: '--series-null' },
        ],
        series: [
          {
            label: 'single best trail (product of DDT entries)',
            colorVar: '--series-trail',
            dash: '7 4',
            marker: 'diamond',
            points: rows.map((r) => Math.log2(r.trailPrediction)),
          },
          {
            label: 'sum over all trails (the differential)',
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
        { label: 'sum over all trails', colorVar: '--series-differential', dash: 'dash' },
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
          ? `Buy the entire 256-plaintext codebook and you get ${firstBelowOne.measuredRightPairs.toFixed(2)} right pairs at ${firstBelowOne.rounds} rounds -- fewer than one. A random permutation would hand you ${result.randomRightPairs.toFixed(2)}. There is no longer a differential to attack with.`
          : `Every round count tested still yields at least one right pair in the full codebook.`
      )
    );

    out.append(
      verdict(
        'fail',
        'AND THE SINGLE-TRAIL PREDICTION IS WRONG',
        `At 6 rounds the best single trail predicts ${log2Label(last.trailPrediction)} and the cipher delivers ${log2Label(last.measured)} -- ${trailError.toFixed(1)} times more often. Hundreds of trails share those two endpoints, and a differential is their sum. Add them up and the prediction lands within ${Math.abs(Math.log2(last.measured) - Math.log2(last.differentialPrediction)).toFixed(2)} bits of the measurement.`
      )
    );

    out.append(rowsTable(rows));

    out.append(
      disclosure('Why the two predictions come apart', [
        el('p', {}, [
          document.createTextNode(
            'A trail fixes the difference after every round. A differential fixes only the two ends. At one round there is exactly one path between any two differences, so the two agree. Every extra round multiplies the number of paths, and the permutation here sends two bits of each S-box into each S-box of the next round, so the paths fan out fast.'
          ),
        ]),
        el('p', {}, [
          document.createTextNode(
            'The consequence cuts both ways, and both matter. A trail-based estimate UNDERSTATES a differential, so a designer who counts trails can believe a cipher safer than it is. And it is the same arithmetic that makes the boomerang estimate in Act 4 wrong -- for the opposite reason.'
          ),
        ]),
        el('p', {}, [
          document.createTextNode(
            'The measured value is not identical to the summed prediction either. The sum assumes the round keys are independent; this key schedule repeats every four rounds, so they are not. The residual gap is that assumption failing, and it is small here.'
          ),
        ]),
      ])
    );
    markRun(out);
  }

  const node = el('section', { class: 'card', 'aria-labelledby': 'act1-title', id: 'act1' }, [
    el('div', { class: 'act-head' }, [
      el('span', { class: 'act-num', text: 'ACT 1' }),
      el('h2', { class: 'act-title', id: 'act1-title', text: 'One trail is not enough' }),
    ]),
    el('p', { class: 'act-lede' }, [
      document.createTextNode(
        'Classical differential cryptanalysis needs one high-probability path all the way through the cipher. Add rounds and the path decays, until fewer than one pair in the entire codebook follows it -- and there is nothing left to count. Press the button; every number below comes from real encryptions.'
      ),
    ]),
    el('div', { class: 'controls' }, [
      field('Keys sampled', keySelect, 'each key contributes all 128 pairs'),
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

  return { node, run };
}
