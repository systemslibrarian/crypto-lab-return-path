/**
 * Act 4 -- the boomerang comes back.
 *
 * Measures the end-to-end return rate against the real cipher and against real
 * random permutations, and says plainly what the measurement can be attributed
 * to: hundreds of middle paths share one (alpha, delta), so the rate is their
 * total. The decomposition reads the real middle difference -- which needs the
 * key, so it is an instrument, not an attack -- to report what share of the
 * returns followed the stated trail.
 *
 * Intervals are a CLUSTER BOOTSTRAP OVER KEYS. The 128 quartets a key
 * contributes share its subkeys, so pooling them and applying a Wilson interval
 * treats correlated events as independent ones and reports an interval that is
 * too narrow. Both are shown, so the cost of the assumption is visible.
 */
import { compute } from './compute.ts';
import type { BoomerangOutcome } from '../crypto/jobs.ts';
import { FAILURE_CODES, FAILURE_TEXT } from '../crypto/failures.ts';
import type { SboxName } from '../crypto/sbox.ts';
import { RANDOM_RETURN_RATE } from '../crypto/experiments.ts';
import { SWITCH_CASES, caseNumbers, type SwitchCase } from './cases.ts';
import { barChart } from './chart.ts';
import { PanelRunner } from './panel.ts';
import {
  callout,
  disclosure,
  el,
  field,
  hex8,
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
  reset(sbox: SboxName, caseId: string): Promise<void>;
  state(): { keys: string };
  restore(s: Partial<{ keys: string }>): void;
}

const KEY_CHOICES = [
  { value: 512, label: '512 keys (65 536 quartets)' },
  { value: 3000, label: '3 000 keys (384 000 quartets)' },
  { value: 12000, label: '12 000 keys (1.5 M quartets)' },
];
const DEFAULT_KEYS = '512';

/** A compact distribution of per-key rates: the spread, not a sentence about it. */
function distribution(perKey: readonly number[], max: number): HTMLElement {
  const BUCKETS = 24;
  const counts = new Array<number>(BUCKETS).fill(0);
  const top = Math.max(max, 1e-9);
  for (const r of perKey) counts[Math.min(BUCKETS - 1, Math.floor((r / top) * BUCKETS))]++;
  const peak = Math.max(...counts, 1);
  const zeroKeys = perKey.filter((r) => r === 0).length;
  return el('div', {}, [
    el(
      'div',
      { class: 'dist', role: 'img', 'aria-label': `Distribution of per-key return rates across ${num(perKey.length)} keys. ${num(zeroKeys)} keys returned nothing at all.` },
      counts.map((c, i) =>
        el('div', {
          class: `dist-bar${i === 0 ? ' dist-bar-zero' : ''}`,
          style: `height: ${Math.max(2, (c / peak) * 100)}%`,
        })
      )
    ),
    el('div', { class: 'dist-axis' }, [
      el('span', { text: '0' }),
      el('span', { text: `per-key return rate → ${top.toExponential(1)}` }),
    ]),
  ]);
}

export function boomerangPanel(): BoomerangPanel {
  const runner = new PanelRunner<{ keys: string; caseId: string; sbox: SboxName }>(
    'boom-out',
    'Act 4 results: boomerang return rate'
  );

  const keySelect = el('select', { id: 'boom-keys' });
  for (const k of KEY_CHOICES) keySelect.append(el('option', { value: String(k.value), text: k.label }));
  keySelect.value = DEFAULT_KEYS;

  const runBtn = el('button', { class: 'btn btn-primary', type: 'button', id: 'boom-run' }, [
    document.createTextNode('Throw the boomerang'),
  ]) as HTMLButtonElement;
  runner.manage(runBtn);

  const recipe = el('div', { id: 'boom-recipe' });

  let currentSbox: SboxName = 'weak';
  let currentCase: SwitchCase = SWITCH_CASES[0];

  function quartetRecipe(c: SwitchCase): HTMLElement {
    return el('ol', { class: 'refs', role: 'list' }, [
      el('li', { role: 'listitem' }, [
        document.createTextNode('Pick P1, set P2 = P1 XOR '),
        el('code', { text: hex8(c.alpha) }),
        document.createTextNode('. Ask the encryption oracle for C1 and C2.'),
      ]),
      el('li', { role: 'listitem' }, [
        document.createTextNode('Shift both ciphertexts by '),
        el('code', { text: hex8(c.delta) }),
        document.createTextNode(' to get C3 and C4.'),
      ]),
      el('li', { role: 'listitem' }, [
        document.createTextNode('Ask the DECRYPTION oracle for P3 and P4 — the step that makes the attack model strong.'),
      ]),
      el('li', { role: 'listitem' }, [
        document.createTextNode('It RETURNED when P3 XOR P4 is '),
        el('code', { text: hex8(c.alpha) }),
        document.createTextNode(': the difference you started with, come back.'),
      ]),
    ]);
  }

  async function run(sbox: SboxName, caseId: string): Promise<void> {
    currentSbox = sbox;
    currentCase = SWITCH_CASES.find((c) => c.id === caseId) ?? SWITCH_CASES[0];
    const c = currentCase;
    recipe.replaceChildren(quartetRecipe(c));
    const keyCount = Number(keySelect.value);
    await runner.run(
      { keys: keySelect.value, caseId: c.id, sbox },
      `Building ${num(keyCount * 128)} quartets, and as many against random permutations…`,
      () =>
        compute({
          kind: 'boomerang',
          sbox,
          alpha: c.alpha,
          beta: c.beta,
          delta: c.delta,
          rounds: c.rounds,
          switchRound: c.switchRound,
          keyCount,
          seed: 31337,
        }) as Promise<BoomerangOutcome>,
      (result) => render(result)
    );
  }

  function render(r: BoomerangOutcome): string {
    const out = runner.out;
    const c = currentCase;
    const n = caseNumbers(c, currentSbox);
    const cipher = r.cipher;
    const nul = r.nullModel;
    const beatsNull = cipher.ci[0] > nul.ci[1];
    const times = nul.rate > 0 ? cipher.rate / nul.rate : Infinity;

    out.append(
      barChart({
        title: 'Measured return rate against the two predictions and against random permutations',
        floor: Math.pow(2, -18),
        bars: [
          { label: 'measured (real cipher)', value: cipher.rate, colorVar: '--series-measured', interval: cipher.ci },
          { label: 'p2q2, switch ignored', value: n.p2q2, colorVar: '--series-differential', hatch: true },
          { label: 'round-trip table', value: n.bctEstimate, colorVar: '--good', hatch: true },
          { label: 'trail across the switch', value: n.trailEstimate, colorVar: '--series-trail', hatch: true },
          { label: 'random permutation', value: nul.rate, colorVar: '--series-null', interval: nul.ci },
        ],
      })
    );

    if (beatsNull) {
      out.append(
        verdict(
          'pass',
          'IT CAME BACK',
          `${num(cipher.returned)} of ${num(cipher.quartets)} quartets returned the difference they started with — ${times.toFixed(1)} times as often as the same procedure against ${num(nul.keysUsed)} real random permutations, intervals disjoint. A distinguisher: it tells this cipher from a random one using only the two oracles, never the key.`,
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
          ? `p = ${n.p.toFixed(4)}, q = ${n.q.toFixed(4)}, so p2q2 = ${probLabel(n.p2q2)}. The cipher returns ${probLabel(cipher.rate)} — ${ratio.toFixed(1)} times less often. Act 5 takes the switch apart; the rest is the two backward pairs, which the estimate treats as independent and which are not.`
          : `p = ${n.p.toFixed(4)}, q = ${n.q.toFixed(4)}, p2q2 = ${probLabel(n.p2q2)}, inside the measured interval.`,
        'boom-p2q2'
      )
    );

    out.append(
      el('div', { class: 'readout' }, [
        stat('measured return rate', probLabel(cipher.rate), `${oneInLabel(cipher.rate)} quartets`, 'accent'),
        stat(
          '95% interval (keys resampled)',
          `${cipher.ci[0].toExponential(2)} .. ${cipher.ci[1].toExponential(2)}`,
          `${num(cipher.returned)} of ${num(cipher.quartets)} quartets, ${num(cipher.keysUsed)} keys`
        ),
        stat('random permutations', probLabel(nul.rate), `measured; theory says ${RANDOM_RETURN_RATE.toExponential(3)}`, 'warn'),
        stat(
          'versus chance',
          times === Infinity ? 'n/a' : `${times.toFixed(1)}×`,
          beatsNull ? 'intervals do not overlap' : 'intervals overlap',
          beatsNull ? 'good' : 'bad'
        ),
        stat(
          'degenerate quartets excluded',
          num(cipher.degenerate),
          'the shifted pair was the original pair'
        ),
      ])
    );

    const d = r.decomposition;
    out.append(
      callout('caveat', 'What this rate can and cannot be attributed to', [
        el('p', {}, [
          document.createTextNode(
            `A rate for one (alpha, delta) is the total over every middle path joining them, not the trail named above. Reading the real middle difference separates them — that needs the key, so it is an instrument, not an attack — and ${pctLabel(d.onTrailReturned / Math.max(1, d.returned))} of returns were on the stated trail.`
          ),
        ]),
      ])
    );

    out.append(
      disclosure('Inspect the evidence: per-key spread, the null, and the independence cost', [
        el('p', {}, [
          document.createTextNode(
            `Per-key return rates across the ${num(cipher.keysUsed)} keys measured. A trail probability is a rate over keys and pairs; it is not a promise about the key in front of you.`
          ),
        ]),
        distribution(cipher.perKeySorted, cipher.perKeySorted[cipher.perKeySorted.length - 1] || 1),
        el('p', { class: 'field-hint' }, [
          document.createTextNode(
            `Median ${cipher.perKeySorted[Math.floor(cipher.perKeySorted.length / 2)].toExponential(2)}, maximum ${cipher.perKeySorted[cipher.perKeySorted.length - 1].toExponential(2)}, and ${num(cipher.perKeySorted.filter((x) => x === 0).length)} keys returned nothing at all in their 128 quartets.`
          ),
        ]),
        el('p', {}, [
          document.createTextNode(
            `Pooling the quartets and applying a Wilson interval would give ${cipher.ciPooled[0].toExponential(2)} .. ${cipher.ciPooled[1].toExponential(2)} — narrower than the ${cipher.ci[0].toExponential(2)} .. ${cipher.ci[1].toExponential(2)} above, because it treats ${num(cipher.quartets)} correlated quartets as that many independent trials. The interval the page reports resamples KEYS, which is the unit that is actually independent.`
          ),
        ]),
        el('p', {}, [
          document.createTextNode(
            `The random-permutation rate is 1 in 253, not 1 in 255, and that is a consequence of the exclusion rule. Once the degenerate quartet is dropped, P3 and P4 are two distinct plaintexts outside the original pair: P3 has 254 choices and P4 the 253 that remain, exactly one of which is P3 XOR alpha. ${num(cipher.degenerate)} degenerate quartets were excluded here — negligible on a 64-bit block, percent-scale on an 8-bit one.`
          ),
        ]),
      ])
    );

    return `Boomerang complete: ${probLabel(cipher.rate)} over ${num(cipher.quartets)} quartets, ${times.toFixed(1)} times the random-permutation rate.`;
  }

  const node = el('section', { class: 'card', 'aria-labelledby': 'act4-title', id: 'act4' }, [
    el('div', { class: 'act-head' }, [
      el('span', { class: 'act-num', text: 'ACT 4' }),
      el('h2', { class: 'act-title', id: 'act4-title', text: 'The boomerang: two short trails instead of one long one' }),
    ]),
    el('p', { class: 'act-lede' }, [
      document.createTextNode(
        'Wagner, 1999: stop trying to cross the whole cipher. Split it, take a short trail through each half, and join them with four texts instead of two.'
      ),
    ]),
    callout('caveat', 'Attack model', [
      el('p', {}, [
        document.createTextNode(
          'A chosen-plaintext oracle AND an adaptive chosen-ciphertext one: the ciphertexts you ask to decrypt are chosen after the first two come back. A strong assumption, and why rectangle attacks exist.'
        ),
      ]),
    ]),
    recipe,
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
    void run(currentSbox, currentCase.id);
  });

  return {
    node,
    run,
    async reset(sbox: SboxName, caseId: string) {
      currentSbox = sbox;
      keySelect.value = DEFAULT_KEYS;
      await run(sbox, caseId);
    },
    state: () => ({ keys: keySelect.value }),
    restore(s) {
      if (s.keys && KEY_CHOICES.some((k) => String(k.value) === s.keys)) keySelect.value = s.keys;
    },
  };
}
