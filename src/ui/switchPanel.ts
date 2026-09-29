/**
 * Act 5 -- the switch, which is what this lab is for.
 *
 * TWO things happen here, and keeping them apart is what makes the act honest:
 *
 *  1. THE WALK. One real quartet, stepped by the reader on a square whose corners
 *     never move, showing the difference at every stage. At the switch it shows
 *     the one-way table entry for the crossing -- often zero -- and then walks the
 *     round trip and shows it closing anyway. Every value comes from the real
 *     cipher under a real key.
 *
 *  2. THE MEASUREMENT. The switch on its own, over ALL 256 middle states. No
 *     sampling and no interval: every state is tried, so the rate is exact.
 *
 * SCOPE, per verification gate V2: the switch is exactly ONE substitution layer,
 * which is what the basic Boomerang Connectivity Table covers. Nothing here
 * extends it to a multi-round middle section.
 */
import { compute } from './compute.ts';
import type { QuartetOutcome } from '../crypto/jobs.ts';
import { FAILURE_CODES, FAILURE_TEXT } from '../crypto/failures.ts';
import { getSbox, type SboxName } from '../crypto/sbox.ts';
import { tablesFor } from '../crypto/tables.ts';
import { measureSwitch, MASTER_KEY_SPACE, type SwitchMeasurement } from '../crypto/experiments.ts';
import type { QuartetWalk } from '../crypto/experiments.ts';
import { SWITCH_CASES, caseNumbers, type SwitchCase } from './cases.ts';
import { quartetSquare, type QuartetDiagramData } from './diagrams.ts';
import { tableView } from './tableView.ts';
import { PanelRunner } from './panel.ts';
import { setBusy } from './latest.ts';
import {
  callout,
  clear,
  disclosure,
  el,
  field,
  hex16,
  hex4,
  hex8,
  markRun,
  num,
  probLabel,
  scrollRegion,
  stat,
  verdict,
} from './dom.ts';

export interface SwitchPanel {
  readonly node: HTMLElement;
  onCaseChange(fn: (caseId: string) => void): void;
  run(sbox: SboxName): Promise<void>;
  currentCaseId(): string;
  stepOnce(): void;
  reset(sbox: SboxName): Promise<void>;
  state(): { case: string; switchRound: string };
  restore(s: Partial<{ case: string; switchRound: string }>): void;
}

interface Step {
  readonly text: string;
  readonly diff: string;
  readonly note?: string;
}

const TOTAL_STEPS = 8;

function walkSteps(c: SwitchCase, w: QuartetWalk, n: ReturnType<typeof caseNumbers>): Step[] {
  const both = (a: number, b: number): string => `${hex8(a)} , ${hex8(b)}`;
  return [
    {
      text: `Two plaintexts differing by alpha: P1 = ${hex8(w.p1)}, P2 = ${hex8(w.p2)}.`,
      diff: `P1 XOR P2 = ${hex8(w.p1 ^ w.p2)}`,
      note: `alpha = ${hex8(c.alpha)}`,
    },
    {
      text:
        n.e0Layers === 0
          ? `The switch is at round 1, so the first half is empty and the pair arrives still differing by alpha. States ${both(w.x1, w.x2)}.`
          : `Encrypt ${n.e0Layers} round${n.e0Layers === 1 ? '' : 's'} to reach the switch. States ${both(w.x1, w.x2)}.`,
      diff: `difference at the switch = ${hex8(w.x1 ^ w.x2)}`,
      note: `beta = ${hex8(c.beta)}${n.e0Layers === 0 ? ' (= alpha, first half empty)' : `, this half holds with probability ${n.p.toFixed(4)}`}`,
    },
    {
      text: `Through the switch's substitution: ${both(w.y1, w.y2)}. A trail would now have to cross beta to gamma in one direction, and the one-way table gives ${n.ddtHigh} of 16 on the high S-box and ${n.ddtLow} of 16 on the low one.`,
      diff: `one-way crossing = ${n.ddtHigh}/16 × ${n.ddtLow}/16`,
      note:
        n.ddtHigh === 0 || n.ddtLow === 0
          ? 'A zero entry. In one direction this crossing cannot happen at all — for any key.'
          : 'Positive, but small.',
    },
    {
      text: `Finish encrypting. Ciphertexts C1 = ${hex8(w.c1)}, C2 = ${hex8(w.c2)}.`,
      diff: `C1 XOR C2 = ${hex8(w.c1 ^ w.c2)}`,
      note: 'Not delta, and it does not need to be. The boomerang never asks for that.',
    },
    {
      text: `Shift both ciphertexts by delta and ask the decryption oracle. C3 = ${hex8(w.c3)}, C4 = ${hex8(w.c4)}.`,
      diff: `delta = ${hex8(c.delta)}`,
      note: 'This is the adaptive chosen-ciphertext step.',
    },
    {
      text: `Decrypt back to the switch's output: ${both(w.y3, w.y4)}. Compare each with its partner from the forward pair.`,
      diff: `y3 XOR y1 = ${hex8(w.gammaPair1)} and y4 XOR y2 = ${hex8(w.gammaPair2)}`,
      note: `gamma = ${hex8(c.gamma)}${n.e1Layers === 0 ? ' (= delta, second half empty)' : `, each backward pair holds with probability ${n.q.toFixed(4)}`}`,
    },
    {
      text: `Back through the switch's substitution: ${both(w.x3, w.x4)}. This is the round trip — in with beta, shifted by gamma, out again.`,
      diff: `difference back at the switch = ${hex8(w.x3 ^ w.x4)}`,
      note:
        w.backwardMid === c.beta
          ? `beta again. The round-trip table gives ${n.bctHigh} of 16 and ${n.bctLow} of 16 — and the crossing a trail called impossible has just happened in both directions at once.`
          : 'Not beta: this quartet did not close at the switch.',
    },
    {
      text: `Finish decrypting to the plaintexts. P3 = ${hex8(w.p3)}, P4 = ${hex8(w.p4)}.`,
      diff: `P3 XOR P4 = ${hex8(w.p3 ^ w.p4)}`,
      note: w.returned ? 'The difference you started with. The boomerang came back.' : 'Not alpha. This quartet did not return.',
    },
  ];
}

export function switchPanel(): SwitchPanel {
  const caseButtons = el('div', { class: 'seg', role: 'group', 'aria-label': 'Switch case' });
  const buttons = new Map<string, HTMLButtonElement>();
  for (const c of SWITCH_CASES) {
    const b = el(
      'button',
      {
        class: 'seg-btn',
        type: 'button',
        'aria-pressed': c.id === SWITCH_CASES[0].id ? 'true' : 'false',
        'data-case': c.id,
      },
      [document.createTextNode(c.label)]
    ) as HTMLButtonElement;
    buttons.set(c.id, b);
    caseButtons.append(b);
  }

  const splitSelect = el('select', { id: 'switch-round' });
  const stepBtn = el('button', { class: 'btn btn-primary', type: 'button', id: 'walk-step' }, [
    document.createTextNode('Step the quartet'),
  ]) as HTMLButtonElement;
  const resetBtn = el('button', { class: 'btn', type: 'button', id: 'walk-reset' }, [
    document.createTextNode('Reset'),
  ]) as HTMLButtonElement;

  const squareOut = el('div', { id: 'quartet-out' });
  const stepsOut = el('div', {
    id: 'walk-out',
    role: 'region',
    'aria-label': 'Act 5: the quartet walk, step by step',
    'data-run': '0',
  });
  const walkAnnounce = el('p', {
    class: 'announce',
    id: 'walk-announce',
    role: 'status',
    'aria-live': 'polite',
  });
  const runner = new PanelRunner<{ caseId: string; switchRound: string; sbox: SboxName }>(
    'switch-out',
    'Act 5 results: the switch measured over every middle state'
  );

  let currentSbox: SboxName = 'weak';
  let currentCase: SwitchCase = SWITCH_CASES[0];
  let steps: Step[] = [];
  let shown = 0;
  let walk: QuartetWalk | null = null;
  const listeners: ((id: string) => void)[] = [];
  const storyOut = el('div', { id: 'switch-story' }, [el('p', { text: SWITCH_CASES[0].story })]);

  function switchRound(): number {
    return Number(splitSelect.value || currentCase.switchRound);
  }

  function refreshSplitOptions(): void {
    const prev = splitSelect.value;
    clear(splitSelect);
    for (let r = 1; r <= currentCase.rounds; r++) {
      const e0 = r - 1;
      const e1 = currentCase.rounds - r;
      splitSelect.append(
        el('option', {
          value: String(r),
          text: `round ${r} — ${e0} layer${e0 === 1 ? '' : 's'} before, ${e1} after`,
        })
      );
    }
    splitSelect.value =
      prev && Number(prev) >= 1 && Number(prev) <= currentCase.rounds ? prev : String(currentCase.switchRound);
  }

  function squareData(): QuartetDiagramData {
    const c = currentCase;
    const w = walk;
    const known = (s: number, v: number): number | null => (w && w.found && shown >= s ? v : null);
    return {
      p1: { name: 'P1', value: known(1, w?.p1 ?? 0) },
      p2: { name: 'P2', value: known(1, w?.p2 ?? 0) },
      c1: { name: 'C1', value: known(4, w?.c1 ?? 0) },
      c2: { name: 'C2', value: known(4, w?.c2 ?? 0) },
      c3: { name: 'C3', value: known(5, w?.c3 ?? 0) },
      c4: { name: 'C4', value: known(5, w?.c4 ?? 0) },
      p3: { name: 'P3', value: known(7, w?.p3 ?? 0) },
      p4: { name: 'P4', value: known(7, w?.p4 ?? 0) },
      alpha: c.alpha,
      delta: c.delta,
      step: shown,
      returned: !!w?.returned,
    };
  }

  function renderSquare(): void {
    squareOut.replaceChildren(quartetSquare(squareData()));
  }

  function renderSteps(): void {
    clear(stepsOut);
    if (!walk || !walk.found) {
      markRun(stepsOut);
      return;
    }
    const list = el('div', { class: 'steps' });
    steps.forEach((s, i) => {
      const state = i < shown - 1 ? 'done' : i === shown - 1 ? 'current' : 'pending';
      list.append(
        el('div', { class: 'step-line', 'data-state': state, 'data-step': String(i + 1) }, [
          el('span', {
            class: 'step-mark',
            'aria-hidden': 'true',
            text: state === 'pending' ? '·' : state === 'done' ? '✓' : '→',
          }),
          el('span', { class: 'step-text' }, [
            document.createTextNode(state === 'pending' ? `Step ${i + 1}` : s.text),
            ...(state === 'pending'
              ? []
              : [
                  document.createTextNode(' '),
                  el('span', { class: 'step-diff', text: s.diff }),
                  ...(s.note ? [el('span', { class: 'corner-role', text: s.note })] : []),
                ]),
          ]),
        ])
      );
    });
    stepsOut.append(list);
    stepsOut.append(el('p', { class: 'field-hint', id: 'walk-progress', text: `Step ${shown} of ${steps.length}.` }));

    if (shown >= steps.length && walk.returned) {
      const n = caseNumbers(currentCase, currentSbox, switchRound());
      stepsOut.append(
        verdict(
          'alarm',
          'IMPOSSIBLE ONE WAY — AND THE BOOMERANG STILL RETURNED',
          `Every check in this walk passed: the forward half reached beta, both backward pairs carried gamma, the round trip closed on beta, and the plaintext difference came back as alpha. And the one-way crossing at the switch has table entries of ${n.ddtHigh}/16 and ${n.ddtLow}/16. A zero there proves a difference can never cross in one direction. It does not prove the boomerang cannot cross it.`,
          'walk-verdict'
        )
      );
    }
    markRun(stepsOut);
  }

  function renderMeasurement(): string {
    const out = runner.out;
    const sbox = getSbox(currentSbox);
    const { ddt, bct } = tablesFor(sbox);
    const rows: SwitchMeasurement[] = SWITCH_CASES.map((c) => measureSwitch(c.beta, c.gamma, sbox, ddt, bct));
    const mine = measureSwitch(currentCase.beta, currentCase.gamma, sbox, ddt, bct);
    const n = caseNumbers(currentCase, currentSbox, switchRound());

    out.append(
      verdict(
        mine.matchesBct ? 'pass' : 'fail',
        mine.matchesBct ? 'THE ROUND-TRIP TABLE IS EXACTLY RIGHT' : 'THE ROUND-TRIP TABLE IS WRONG',
        mine.matchesBct
          ? `${mine.closed} of ${mine.states} middle states close the round trip, and the table predicts exactly ${mine.closed}. Not approximately \u2014 all 256 states were tried. ${mine.matchesTrail ? 'Here the trail reading agrees too.' : `The trail reading predicts ${probLabel(mine.trailPrediction)}, which is not what happens.`}`
          : 'This should be impossible — the measurement is the table’s own definition applied to both nibbles.',
        'switch-verdict'
      )
    );

    if (mine.measured === 0) {
      out.append(
        verdict(
          'fail',
          `THE SWITCH NEVER CLOSES — ${FAILURE_CODES.SWITCH_INCOMPATIBLE}`,
          `${FAILURE_TEXT.E_SWITCH_INCOMPATIBLE} Zero of 256 middle states. Two trails picked independently can simply refuse to join — Murphy's 2011 observation — and p2q2 would have promised ${probLabel(n.p2q2)}.`,
          'switch-incompatible'
        )
      );
    }

    out.append(
      el('div', { class: 'readout' }, [
        stat('switch measured', probLabel(mine.measured), `${mine.closed} of ${mine.states} states — every one tried`, 'accent'),
        stat('round-trip table says', probLabel(mine.bctPrediction), `${mine.bctHigh}/16 × ${mine.bctLow}/16`, mine.matchesBct ? 'good' : 'bad'),
        stat('trail reading says', probLabel(mine.trailPrediction), `(${mine.ddtHigh}/16)² × (${mine.ddtLow}/16)²`, mine.matchesTrail ? undefined : 'bad'),
        stat(
          'trail reading is out by',
          mine.trailPrediction > 0
            ? `${(mine.measured / mine.trailPrediction).toFixed(0)}×`
            : mine.measured > 0
              ? 'infinitely'
              : 'not at all',
          mine.measured > 0 && mine.trailPrediction === 0 ? 'it predicts never; it happens always' : 'measured ÷ trail',
          mine.matchesTrail ? undefined : 'bad'
        ),
      ])
    );

    out.append(
      el('div', { class: 'readout' }, [
        stat(
          'split point',
          `round ${switchRound()}`,
          `${n.e0Layers} layer${n.e0Layers === 1 ? '' : 's'} before, ${n.e1Layers} after`
        ),
        stat('p (first half)', n.p > 0 ? n.p.toFixed(4) : 'no trail', n.e0Layers === 0 ? 'empty half' : `alpha → beta`),
        stat('q (second half)', n.q > 0 ? n.q.toFixed(4) : 'no trail', n.e1Layers === 0 ? 'empty half' : `gamma → delta`),
        stat(
          'p²q² × round trip',
          n.p > 0 && n.q > 0 ? probLabel(n.bctEstimate) : 'n/a',
          n.p > 0 && n.q > 0 ? 'the corrected estimate' : 'one half has no trail at this split'
        ),
      ])
    );

    if (n.p === 0 || n.q === 0) {
      out.append(
        verdict(
          'info',
          `NO TRAIL AT THIS SPLIT — ${FAILURE_CODES.NO_TRAIL}`,
          `${FAILURE_TEXT.E_NO_TRAIL} Moving the switch to round ${switchRound()} leaves ${n.p === 0 ? 'the first' : 'the second'} half with no path between the differences this case names. The page reports that rather than printing a probability of zero as if it were a measurement.`,
          'switch-notrail'
        )
      );
    }

    out.append(
      scrollRegion('Every shipped switch case, measured', 'table-wrap', [
        el('table', {}, [
          el('caption', {
            text: 'All four cases, each measured over all 256 middle states. The last column is the factor the trail reading gets wrong.',
          }),
          el('thead', {}, [
            el('tr', {}, [
              el('th', { scope: 'col', text: 'case' }),
              el('th', { scope: 'col', text: 'beta' }),
              el('th', { scope: 'col', text: 'gamma' }),
              el('th', { scope: 'col', text: 'one-way' }),
              el('th', { scope: 'col', text: 'round-trip' }),
              el('th', { scope: 'col', text: 'measured' }),
              el('th', { scope: 'col', text: 'trail error' }),
            ]),
          ]),
          el(
            'tbody',
            {},
            rows.map((m, i) =>
              el('tr', {}, [
                el('th', { scope: 'row', text: SWITCH_CASES[i].short }),
                el('td', { text: hex8(m.beta) }),
                el('td', { text: hex8(m.gamma) }),
                el('td', { text: `${m.ddtHigh}x${m.ddtLow} /16` }),
                el('td', { text: `${m.bctHigh}x${m.bctLow} /16` }),
                el('td', { text: `${m.closed}/256` }),
                el('td', {
                  text:
                    m.trailPrediction > 0
                      ? `${(m.measured / m.trailPrediction).toFixed(0)}x`
                      : m.measured > 0
                        ? 'says never'
                        : 'exact',
                }),
              ])
            )
          ),
        ]),
      ])
    );

    const bh = (currentCase.beta >> 4) & 0xf;
    const bl = currentCase.beta & 0xf;
    const gh = (currentCase.gamma >> 4) & 0xf;
    const gl = currentCase.gamma & 0xf;
    out.append(
      disclosure('Inspect the evidence: the two tables, with this switch’s cells marked', [
        el('p', { class: 'scroll-note', text: 'Both tables are 16 columns wide and scroll sideways on a narrow screen.' }),
        el('p', {}, [
          document.createTextNode(
            `Both are computed from the S-box on this page. The marked cells are (${hex4(bh)}, ${hex4(gh)}) for the high S-box and (${hex4(bl)}, ${hex4(gl)}) for the low one.`
          ),
        ]),
        tableView(
          ddt,
          'One-way table (DDT): how many of the 16 inputs turn this input difference into that output difference.',
          'Difference distribution table',
          [
            { row: bh, col: gh, tone: ddt[bh][gh] === 0 ? 'bad' : 'ok' },
            { row: bl, col: gl, tone: ddt[bl][gl] === 0 ? 'bad' : 'ok' },
          ],
          8
        ),
        tableView(
          bct,
          'Round-trip table (BCT): how many of the 16 inputs let the boomerang go in with this difference, shift by that amount, and come back out with the same one.',
          'Boomerang connectivity table',
          [
            { row: bh, col: gh, tone: bct[bh][gh] === 0 ? 'bad' : 'ok' },
            { row: bl, col: gl, tone: bct[bl][gl] === 0 ? 'bad' : 'ok' },
          ],
          10
        ),
        el('p', {}, [
          document.createTextNode(
            'Three identities hold for any invertible S-box, and the suite checks all three by brute force rather than quoting them: the round-trip table’s first row and column are all 16; every round-trip entry is at least the matching one-way entry; and every round-trip entry is even. The second has a consequence worth stating plainly — at a single substitution layer the round trip can only ever be EASIER than the one-way crossing, never harder. So a switch this narrow cannot be what makes a boomerang rarer than predicted; that needs a wider middle than this page covers.'
          ),
        ]),
      ])
    );

    return `Switch measured: ${mine.closed} of ${mine.states} middle states close the round trip, ${mine.matchesBct ? 'exactly as the round-trip table predicts' : 'which the round-trip table did not predict'}.`;
  }

  async function run(sbox: SboxName): Promise<void> {
    currentSbox = sbox;
    const c = currentCase;
    const sr = switchRound();
    clear(stepsOut);
    stepsOut.append(el('p', { class: 'field-hint', text: 'Searching for a quartet that follows this trail…' }));
    setBusy(stepsOut, true);
    stepBtn.disabled = true;
    resetBtn.disabled = true;

    const measurementDone = runner.run(
      { caseId: c.id, switchRound: String(sr), sbox },
      'Measuring the switch over all 256 middle states…',
      async () => null,
      () => renderMeasurement()
    );

    const result = (await compute({
      kind: 'quartet',
      sbox,
      alpha: c.alpha,
      beta: c.beta,
      gamma: c.gamma,
      delta: c.delta,
      rounds: c.rounds,
      switchRound: sr,
      startKey: 0x0000,
      limit: MASTER_KEY_SPACE,
    })) as QuartetOutcome;

    // Only paint the walk if this is still the newest request: the measurement
    // and the walk are driven together and must never disagree about the case.
    if (runner.currentId !== 0 && String(sr) !== splitSelect.value) return;
    walk = result.walk;
    steps = walk.found ? walkSteps(c, walk, caseNumbers(c, sbox, sr)) : [];
    shown = walk.found ? 1 : 0;
    clear(stepsOut);
    setBusy(stepsOut, false);

    if (!walk.found) {
      stepBtn.disabled = true;
      resetBtn.disabled = true;
      const m = measureSwitch(c.beta, c.gamma, getSbox(sbox), tablesFor(getSbox(sbox)).ddt, tablesFor(getSbox(sbox)).bct);
      stepsOut.append(
        verdict(
          'fail',
          'NO QUARTET FOLLOWS THIS TRAIL',
          `Every one of the ${num(result.keysTried)} master keys was tried and none produced a quartet in which all four legs hold at once. ${
            m.measured === 0
              ? `That is expected here: the round trip closes for none of the 256 middle states (${FAILURE_CODES.SWITCH_INCOMPATIBLE}), so the walk has nothing to show and the page says so rather than showing a quartet that merely looks like the trail.`
              : 'The switch does close for some middle states, but an 8-bit block offers only 128 pairs per key, and four conditions at once can have no common solution in that many. A trail probability is not a promise about any particular key.'
          }`,
          'walk-verdict'
        )
      );
      walkAnnounce.textContent = 'No quartet follows this trail under any key.';
      markRun(stepsOut);
    } else {
      stepBtn.disabled = false;
      resetBtn.disabled = false;
      stepsOut.append(
        el('p', { class: 'field-hint', id: 'walk-key' }, [
          document.createTextNode(
            `Key ${hex16(result.masterKey)}, found after trying ${num(result.keysTried)} of ${num(MASTER_KEY_SPACE)}. Every value below comes from the real cipher under that key.`
          ),
        ])
      );
      walkAnnounce.textContent = `Quartet found under key ${hex16(result.masterKey)}. Step 1 of ${TOTAL_STEPS}.`;
      renderSteps();
    }
    renderSquare();
    await measurementDone;
  }

  function advance(): void {
    if (!walk || !walk.found) return;
    if (shown < steps.length) shown += 1;
    stepBtn.disabled = shown >= steps.length;
    renderSquare();
    renderSteps();
    walkAnnounce.textContent =
      shown >= steps.length
        ? `Step ${shown} of ${steps.length}. ${walk.returned ? 'The boomerang returned.' : 'The quartet did not return.'}`
        : `Step ${shown} of ${steps.length}.`;
  }

  stepBtn.addEventListener('click', advance);
  resetBtn.addEventListener('click', () => {
    shown = 1;
    stepBtn.disabled = false;
    renderSquare();
    renderSteps();
    walkAnnounce.textContent = `Reset to step 1 of ${TOTAL_STEPS}.`;
  });

  for (const [id, btn] of buttons) {
    btn.addEventListener('click', () => {
      currentCase = SWITCH_CASES.find((c) => c.id === id) ?? SWITCH_CASES[0];
      for (const [otherId, other] of buttons) other.setAttribute('aria-pressed', otherId === id ? 'true' : 'false');
      refreshSplitOptions();
      splitSelect.value = String(currentCase.switchRound);
      storyOut.replaceChildren(el('p', { text: currentCase.story }));
      void run(currentSbox);
      for (const fn of listeners) fn(id);
    });
  }
  splitSelect.addEventListener('change', () => {
    void run(currentSbox);
  });

  refreshSplitOptions();

  const node = el('section', { class: 'card', 'aria-labelledby': 'act5-title', id: 'act5' }, [
    el('div', { class: 'act-head' }, [
      el('span', { class: 'act-num', text: 'ACT 5' }),
      el('h2', { class: 'act-title', id: 'act5-title', text: 'The switch, where the estimate breaks' }),
    ]),
    el('p', { class: 'act-lede' }, [
      document.createTextNode(
        'p2q2 assumes the halves behave independently. A trail crosses the layer where they meet once, in one direction; a boomerang crosses it twice, out and back. Different questions, different answers.'
      ),
    ]),
    el('div', { class: 'controls' }, [
      field('Switch case', caseButtons),
      field('Split point', splitSelect, 'where E0 ends and E1 begins'),
    ]),
    storyOut,
    el('h3', { class: 'subhead', text: 'One real quartet, step by step' }),
    squareOut,
    el('div', { class: 'controls' }, [
      el('div', { class: 'field' }, [
        el('span', { class: 'group-label', 'aria-hidden': 'true', text: ' ' }),
        stepBtn,
      ]),
      el('div', { class: 'field' }, [
        el('span', { class: 'group-label', 'aria-hidden': 'true', text: ' ' }),
        resetBtn,
      ]),
    ]),
    walkAnnounce,
    stepsOut,
    el('h3', { class: 'subhead', text: 'The switch on its own, over every middle state' }),
    el('p', {}, [
      document.createTextNode(
        'The walk shows one quartet. This tries all 256 states entering the switch and asks, for each, whether the round trip comes back out with the difference it went in with. Exact, not sampled.'
      ),
    ]),
    runner.announce,
    runner.meta,
    runner.out,
    callout('caveat', 'Scope', [
      el('p', {}, [
        document.createTextNode(
          'The round-trip table covers ONE substitution layer \u2014 what Cid et al. defined in 2018, and exactly what the switch above is. Nothing here extends it to a middle section spanning several rounds.'
        ),
      ]),
    ]),
  ]);

  return {
    node,
    onCaseChange(fn) {
      listeners.push(fn);
    },
    run,
    currentCaseId: () => currentCase.id,
    stepOnce: advance,
    async reset(sbox: SboxName) {
      currentSbox = sbox;
      currentCase = SWITCH_CASES[0];
      for (const [otherId, other] of buttons) other.setAttribute('aria-pressed', otherId === currentCase.id ? 'true' : 'false');
      refreshSplitOptions();
      splitSelect.value = String(currentCase.switchRound);
      storyOut.replaceChildren(el('p', { text: currentCase.story }));
      await run(sbox);
    },
    state: () => ({ case: currentCase.id, switchRound: splitSelect.value }),
    restore(s) {
      if (s.case && SWITCH_CASES.some((c) => c.id === s.case)) {
        currentCase = SWITCH_CASES.find((c) => c.id === s.case)!;
        for (const [otherId, other] of buttons) other.setAttribute('aria-pressed', otherId === s.case ? 'true' : 'false');
        storyOut.replaceChildren(el('p', { text: currentCase.story }));
      }
      refreshSplitOptions();
      if (s.switchRound && Number(s.switchRound) >= 1 && Number(s.switchRound) <= currentCase.rounds) {
        splitSelect.value = s.switchRound;
      }
    },
  };
}
