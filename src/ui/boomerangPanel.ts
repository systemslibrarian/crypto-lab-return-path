/**
 * Act 4 -- the boomerang comes back.
 *
 * Measures the end-to-end return rate against the real cipher and against real
 * random permutations, and says plainly what the measurement can and cannot be
 * attributed to: hundreds of middle paths share one (alpha, delta), so the rate
 * is their total. The decomposition below reads the real middle difference --
 * which needs the key, so it is labelled an instrument rather than an attack --
 * and reports what share of the returns followed the stated trail.
 */
import { compute } from './compute.ts';
import type { BoomerangOutcome } from '../crypto/jobs.ts';
import { FAILURE_CODES, FAILURE_TEXT } from '../crypto/failures.ts';
import type { SboxName } from '../crypto/sbox.ts';
import { RANDOM_RETURN_RATE } from '../crypto/experiments.ts';
import { SWITCH_CASES, caseNumbers, type SwitchCase } from './cases.ts';
import { barChart } from './chart.ts';
import {
  callout,
  clear,
  disclosure,
  el,
  field,
  hex8,
  markRun,
  num,
  oneInLabel,
  pctLabel,
  probLabel,
  stat,
  verdict,
} from './dom.ts';

export interface BoomerangPanel {
  readonly node: HTMLElement;
  run(sbox: SboxName, caseId: string): Promise<void>;
}

const KEY_CHOICES = [
  { value: 512, label: '512 keys' },
  { value: 3000, label: '3 000 keys' },
  { value: 12000, label: '12 000 keys' },
];

function quartetRecipe(c: SwitchCase): HTMLElement {
  return el('ol', { class: 'refs', role: 'list' }, [
    el('li', { role: 'listitem' }, [
      document.createTextNode('Pick a plaintext P1 and set P2 = P1 XOR '),
      el('code', { text: hex8(c.alpha) }),
      document.createTextNode('. Ask the encryption oracle for C1 and C2.'),
    ]),
    el('li', { role: 'listitem' }, [
      document.createTextNode('Shift both ciphertexts: C3 = C1 XOR '),
      el('code', { text: hex8(c.delta) }),
      document.createTextNode(', C4 = C2 XOR '),
      el('code', { text: hex8(c.delta) }),
      document.createTextNode('.'),
    ]),
    el('li', { role: 'listitem' }, [
      document.createTextNode('Ask the DECRYPTION oracle for P3 and P4. This step is what makes the attack model strong.'),
    ]),
    el('li', { role: 'listitem' }, [
      document.createTextNode('The quartet RETURNED when P3 XOR P4 is '),
      el('code', { text: hex8(c.alpha) }),
      document.createTextNode(' -- the difference you started with, come back to you.'),
    ]),
  ]);
}

export function boomerangPanel(): BoomerangPanel {
  const keySelect = el('select', { id: 'boom-keys' });
  for (const k of KEY_CHOICES) keySelect.append(el('option', { value: String(k.value), text: k.label }));
  keySelect.value = '512';

  const runBtn = el('button', { class: 'btn btn-primary', type: 'button', id: 'boom-run' }, [
    document.createTextNode('Throw the boomerang'),
  ]);

  const out = el('div', { id: 'boom-out', role: 'status', 'aria-live': 'polite', 'data-run': '0' }, [
    el('p', { class: 'field-hint', text: 'Measuring...' }),
  ]);
  const recipe = el('div', { id: 'boom-recipe' });

  let currentSbox: SboxName = 'weak';
  let currentCase: SwitchCase = SWITCH_CASES[0];

  async function run(sbox: SboxName, caseId: string): Promise<void> {
    currentSbox = sbox;
    currentCase = SWITCH_CASES.find((c) => c.id === caseId) ?? SWITCH_CASES[0];
    const c = currentCase;
    clear(recipe);
    recipe.append(quartetRecipe(c));
    const keyCount = Number(keySelect.value);
    runBtn.disabled = true;
    runBtn.textContent = 'Measuring...';
    clear(out);
    out.append(
      el('p', { class: 'field-hint', text: `Building ${num(keyCount * 128)} quartets, plus the same number against random permutations...` })
    );
    const result = (await compute({
      kind: 'boomerang',
      sbox,
      alpha: c.alpha,
      beta: c.beta,
      delta: c.delta,
      rounds: c.rounds,
      switchRound: c.switchRound,
      keyCount,
      seed: 31337,
    })) as BoomerangOutcome;
    render(result);
    runBtn.disabled = false;
    runBtn.textContent = 'Throw the boomerang';
  }

  function render(r: BoomerangOutcome): void {
    clear(out);
    const c = currentCase;
    const n = caseNumbers(c, currentSbox);
    const cipher = r.cipher;
    const nul = r.nullModel;
    const beatsNull = cipher.ci[0] > nul.ci[1];
    const times = nul.rate > 0 ? cipher.rate / nul.rate : Infinity;

    out.append(
      el('div', { class: 'readout' }, [
        stat('measured return rate', probLabel(cipher.rate), `${oneInLabel(cipher.rate)} quartets`, 'accent'),
        stat(
          '95% interval',
          `${cipher.ci[0].toExponential(2)} .. ${cipher.ci[1].toExponential(2)}`,
          `${num(cipher.returned)} of ${num(cipher.quartets)} quartets`
        ),
        stat('random permutations', probLabel(nul.rate), `measured over ${num(nul.keysUsed)} of them`, 'warn'),
        stat(
          'versus chance',
          times === Infinity ? 'n/a' : `${times.toFixed(1)}x`,
          beatsNull ? 'intervals do not overlap' : 'intervals overlap',
          beatsNull ? 'good' : 'bad'
        ),
      ])
    );

    out.append(
      barChart({
        title: 'Measured return rate against the two predictions and against random permutations',
        floor: Math.pow(2, -18),
        bars: [
          {
            label: 'measured (real cipher)',
            value: cipher.rate,
            colorVar: '--series-measured',
            interval: cipher.ci,
          },
          { label: 'p2q2, switch ignored', value: n.p2q2, colorVar: '--series-differential', hatch: true },
          { label: 'round-trip table', value: n.bctEstimate, colorVar: '--good', hatch: true },
          { label: 'trail across the switch', value: n.trailEstimate, colorVar: '--series-trail', hatch: true },
          {
            label: 'random permutation',
            value: nul.rate,
            colorVar: '--series-null',
            interval: nul.ci,
          },
        ],
      })
    );

    if (beatsNull) {
      out.append(
        verdict(
          'pass',
          'IT CAME BACK',
          `${num(cipher.returned)} of ${num(cipher.quartets)} quartets returned the difference they started with -- ${times.toFixed(1)} times as often as the same procedure run against ${num(nul.keysUsed)} real random permutations, with intervals that do not overlap. That is a distinguisher: it tells this cipher from a random one using only the two oracles, never the key.`,
          'boom-verdict'
        )
      );
    } else {
      out.append(
        verdict(
          'alarm',
          `NO VERDICT — ${FAILURE_CODES.INSUFFICIENT_SAMPLES}`,
          `${FAILURE_TEXT.E_INSUFFICIENT_SAMPLES} Measured ${probLabel(cipher.rate)} against a random-permutation rate of ${probLabel(nul.rate)}.`,
          'boom-verdict'
        )
      );
    }

    const ratio = n.p2q2 > 0 ? n.p2q2 / cipher.rate : 0;
    out.append(
      verdict(
        n.p2q2 > cipher.ci[1] ? 'fail' : 'info',
        n.p2q2 > cipher.ci[1] ? 'AND p2q2 IS WRONG' : 'p2q2 IS WITHIN THE INTERVAL',
        n.p2q2 > cipher.ci[1]
          ? `Wagner's estimate multiplies the two halves' probabilities: p = ${n.p.toFixed(4)}, q = ${n.q.toFixed(4)}, so p2q2 = ${probLabel(n.p2q2)}. The cipher returns ${probLabel(cipher.rate)} -- ${ratio.toFixed(1)} times less often. Act 5 takes the switch apart; the rest of the gap is the two backward pairs, which the estimate treats as independent and which are not.`
          : `p = ${n.p.toFixed(4)}, q = ${n.q.toFixed(4)}, p2q2 = ${probLabel(n.p2q2)}, inside the measured interval.`,
        'boom-p2q2'
      )
    );

    const d = r.decomposition;
    out.append(
      el('div', { class: 'readout' }, [
        stat(
          'forward half held',
          pctLabel(d.onTrail / d.quartets),
          `p predicts ${pctLabel(n.p)}`,
          Math.abs(d.onTrail / d.quartets - n.p) < 0.02 ? 'good' : 'warn'
        ),
        stat(
          'of those, returned',
          pctLabel(d.onTrail > 0 ? d.onTrailReturned / d.onTrail : 0),
          `q2 x switch predicts ${pctLabel(n.q * n.q * n.switchBct)}`,
          'bad'
        ),
        stat(
          'returns on the stated trail',
          pctLabel(d.returned > 0 ? d.onTrailReturned / d.returned : 0),
          'the rest came back by another route',
          undefined
        ),
        stat('degenerate quartets excluded', num(cipher.degenerate), 'the shifted pair was the original pair', undefined),
      ])
    );

    out.append(
      callout('caveat', 'What this rate can and cannot be attributed to', [
        el('p', {}, [
          document.createTextNode(
            `A measured rate for one (alpha, delta) is the total over every middle path that joins them, not the contribution of the trail named above. The decomposition reads the real middle difference to separate them -- that needs the key, so it is an instrument, not an attack -- and finds ${pctLabel(d.onTrailReturned / Math.max(1, d.returned))} of the returns on the stated trail. The rest is other paths and the ${probLabel(RANDOM_RETURN_RATE)} floor. Act 5 measures the switch on its own, where there is nothing to attribute.`
          ),
        ]),
      ])
    );

    out.append(
      disclosure('Per-key spread: one run is not the rate', [
        el('p', {}, [
          document.createTextNode(
            `Across the ${num(cipher.keysUsed)} keys measured, the per-key return rate ranges from ${cipher.perKeySorted[0].toExponential(2)} to ${cipher.perKeySorted[cipher.perKeySorted.length - 1].toExponential(2)}, with a median of ${cipher.perKeySorted[Math.floor(cipher.perKeySorted.length / 2)].toExponential(2)}. Plenty of individual keys return nothing at all in their 128 quartets. A trail probability is a rate over keys and pairs; it is not a promise about the key in front of you.`
          ),
        ]),
        el('p', {}, [
          document.createTextNode(
            `Degenerate quartets are excluded and counted: ${num(cipher.degenerate)} of them here. When the ciphertext shift happens to equal C1 XOR C2, the shifted pair IS the original pair swapped and returns for free. On a 64-bit block that is negligible; on an 8-bit block it happens about as often as the (alpha, delta) differential itself, and counting it would inflate every rate on this page.`
          ),
        ]),
      ])
    );
    markRun(out);
  }

  const node = el('section', { class: 'card', 'aria-labelledby': 'act4-title', id: 'act4' }, [
    el('div', { class: 'act-head' }, [
      el('span', { class: 'act-num', text: 'ACT 4' }),
      el('h2', { class: 'act-title', id: 'act4-title', text: 'The boomerang: two short trails instead of one long one' }),
    ]),
    el('p', { class: 'act-lede' }, [
      document.createTextNode(
        'Wagner’s idea, 1999: stop trying to cross the whole cipher. Split it in half, find a short trail through each, and join them with a quartet of four texts instead of a pair. Two go forward, two come back, and if the difference you started with reappears at the end, the boomerang returned. The estimate is p2q2 -- and the whole reason this lab exists is that the estimate can be wrong.'
      ),
    ]),
    callout('caveat', 'Attack model', [
      el('p', {}, [
        document.createTextNode(
          'This needs a chosen-plaintext oracle AND an adaptive chosen-ciphertext oracle: the two ciphertexts you ask to decrypt are chosen only after the first two come back. That is a strong assumption about what an attacker can do, and it is exactly why rectangle attacks -- which drop the decryption half -- exist.'
        ),
      ]),
    ]),
    recipe,
    el('div', { class: 'controls' }, [
      field('Keys sampled', keySelect, 'each key contributes up to 128 quartets'),
      el('div', { class: 'field' }, [
        el('span', { class: 'group-label', 'aria-hidden': 'true', text: ' ' }),
        runBtn,
      ]),
    ]),
    out,
  ]);

  runBtn.addEventListener('click', () => {
    void run(currentSbox, currentCase.id);
  });

  return { node, run };
}
