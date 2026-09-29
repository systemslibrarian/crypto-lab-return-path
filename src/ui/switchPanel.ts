/**
 * Act 5 -- the switch, which is what this lab is for.
 *
 * TWO things happen here, and keeping them apart is what makes the act honest:
 *
 *  1. THE WALK. One real quartet, stepped through by the reader, showing the
 *     difference at every stage. At the switch it stops and shows the one-way
 *     table entry for the crossing -- often zero -- and then walks the round trip
 *     and shows it closing anyway. Every value is produced by the real cipher
 *     under a real key; nothing is drawn.
 *
 *  2. THE MEASUREMENT. The switch on its own, over ALL 256 middle states. No
 *     sampling, no interval: every state is tried, so the rate is exact. It is
 *     compared against what a trail reading of the same switch predicts. The
 *     round-trip table is right every time and the trail reading is wrong three
 *     times in four -- and it is wrong in the direction that matters, because the
 *     round-trip entry is never below the one-way entry.
 *
 * SCOPE, per verification gate V2: the switch here is exactly ONE substitution
 * layer, which is what the basic Boomerang Connectivity Table covers. Nothing on
 * this page extends it to a multi-round middle section.
 */
import { compute } from './compute.ts';
import type { QuartetOutcome } from '../crypto/jobs.ts';
import { FAILURE_CODES, FAILURE_TEXT } from '../crypto/failures.ts';
import { getSbox, type SboxName } from '../crypto/sbox.ts';
import { tablesFor } from '../crypto/tables.ts';
import { measureSwitch, MASTER_KEY_SPACE, type SwitchMeasurement } from '../crypto/experiments.ts';
import type { QuartetWalk } from '../crypto/experiments.ts';
import { SWITCH_CASES, caseNumbers, type SwitchCase } from './cases.ts';
import { tableView } from './tableView.ts';
import {
  callout,
  clear,
  disclosure,
  el,
  field,
  hex16,
  hex4,
  hex8,
  num,
  probLabel,
  scrollRegion,
  stat,
  verdict,
} from './dom.ts';

export interface SwitchPanel {
  readonly node: HTMLElement;
  /** Notifies the other acts when the reader picks a different case. */
  onCaseChange(fn: (caseId: string) => void): void;
  run(sbox: SboxName): Promise<void>;
  currentCaseId(): string;
}

interface Step {
  readonly text: string;
  readonly diff: string;
  readonly note?: string;
}

function walkSteps(c: SwitchCase, w: QuartetWalk, n: ReturnType<typeof caseNumbers>): Step[] {
  const both = (a: number, b: number): string => `${hex8(a)} , ${hex8(b)}`;
  return [
    {
      text: `Two plaintexts, chosen to differ by alpha. P1 = ${hex8(w.p1)}, P2 = ${hex8(w.p2)}.`,
      diff: `P1 XOR P2 = ${hex8(w.p1 ^ w.p2)}`,
      note: `alpha = ${hex8(c.alpha)}`,
    },
    {
      text:
        n.e0Layers === 0
          ? `The switch is at round 1, so the first half is empty: the pair arrives at the switch still differing by alpha. States ${both(w.x1, w.x2)}.`
          : `Encrypt ${n.e0Layers} round${n.e0Layers === 1 ? '' : 's'} to reach the switch. States ${both(w.x1, w.x2)}.`,
      diff: `difference at the switch = ${hex8(w.x1 ^ w.x2)}`,
      note: `beta = ${hex8(c.beta)}${n.e0Layers === 0 ? ' (= alpha, first half empty)' : `, and this half holds with probability ${n.p.toFixed(4)}`}`,
    },
    {
      text: `Through the switch's substitution: ${both(w.y1, w.y2)}. A trail would now have to cross beta -> gamma in one direction, and the one-way table says that crossing succeeds ${n.ddtHigh} of 16 times on the high S-box and ${n.ddtLow} of 16 on the low one.`,
      diff: `one-way crossing = ${n.ddtHigh}/16 x ${n.ddtLow}/16 = ${probLabel(n.switchTrail > 0 ? Math.sqrt(n.switchTrail) : 0)}`,
      note:
        n.ddtHigh === 0 || n.ddtLow === 0
          ? 'A zero entry. In one direction, this crossing cannot happen at all -- for any key.'
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
      text: `Decrypt back to the switch's output. ${both(w.y3, w.y4)}. Compare each with its partner from the forward pair.`,
      diff: `y3 XOR y1 = ${hex8(w.gammaPair1)} and y4 XOR y2 = ${hex8(w.gammaPair2)}`,
      note: `gamma = ${hex8(c.gamma)}${n.e1Layers === 0 ? ' (= delta, second half empty)' : `, and each backward pair holds with probability ${n.q.toFixed(4)}`}`,
    },
    {
      text: `Back through the switch's substitution: ${both(w.x3, w.x4)}. This is the round trip -- in through beta, shifted by gamma, out again.`,
      diff: `difference back at the switch = ${hex8(w.x3 ^ w.x4)}`,
      note:
        w.backwardMid === c.beta
          ? `beta again. The round-trip table gives ${n.bctHigh} of 16 on the high S-box and ${n.bctLow} of 16 on the low one -- and the crossing a trail called impossible has just happened in both directions at once.`
          : 'Not beta: this quartet did not close at the switch.',
    },
    {
      text: `Finish decrypting to the plaintexts. P3 = ${hex8(w.p3)}, P4 = ${hex8(w.p4)}.`,
      diff: `P3 XOR P4 = ${hex8(w.p3 ^ w.p4)}`,
      note:
        w.returned
          ? 'The difference you started with. The boomerang came back.'
          : 'Not alpha. This quartet did not return.',
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

  const stepBtn = el('button', { class: 'btn btn-primary', type: 'button', id: 'walk-step' }, [
    document.createTextNode('Step the quartet'),
  ]);
  const resetBtn = el('button', { class: 'btn', type: 'button', id: 'walk-reset' }, [
    document.createTextNode('Reset'),
  ]);

  const quartetOut = el('div', { id: 'quartet-out' });
  const stepsOut = el('div', { id: 'walk-out', role: 'status', 'aria-live': 'polite' }, [
    el('p', { class: 'field-hint', text: 'Finding a quartet...' }),
  ]);
  const measureOut = el('div', { id: 'switch-out' });

  let currentSbox: SboxName = 'weak';
  let currentCase: SwitchCase = SWITCH_CASES[0];
  let steps: Step[] = [];
  let shown = 0;
  let walk: QuartetWalk | null = null;
  const listeners: ((id: string) => void)[] = [];

  function renderSteps(): void {
    clear(stepsOut);
    if (!walk || !walk.found) return;
    const list = el('div', { class: 'steps' });
    steps.forEach((s, i) => {
      const state = i < shown - 1 ? 'done' : i === shown - 1 ? 'current' : 'pending';
      const line = el('div', { class: 'step-line', 'data-state': state, 'data-step': String(i + 1) }, [
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
      ]);
      list.append(line);
    });
    stepsOut.append(list);
    stepsOut.append(
      el('p', {
        class: 'field-hint',
        id: 'walk-progress',
        text: `Step ${shown} of ${steps.length}.`,
      })
    );
    if (shown >= steps.length && walk.returned) {
      stepsOut.append(
        verdict(
          'alarm',
          'IMPOSSIBLE ONE WAY — AND THE BOOMERANG STILL RETURNED',
          `Every check in this walk passed: the forward half reached beta, both backward pairs carried gamma, the round trip closed on beta, and the plaintext difference came back as alpha. And the one-way crossing at the switch has a table entry of ${currentCase.id === 'ladder' || currentCase.id === 'amplified' ? 'zero or near zero' : 'its own'} -- ${caseNumbers(currentCase, currentSbox).ddtHigh}/16 and ${caseNumbers(currentCase, currentSbox).ddtLow}/16. A zero in the one-way table proves a difference can never cross in one direction. It does not prove the boomerang cannot cross it.`,
          'walk-verdict'
        )
      );
    }
  }

  function renderQuartet(): void {
    clear(quartetOut);
    if (!walk || !walk.found) return;
    const live = (i: number): boolean => shown >= i;
    quartetOut.append(
      el('div', { class: 'quartet' }, [
        el('div', { class: `corner${live(1) ? ' corner-live' : ''}` }, [
          el('span', { class: 'corner-name', text: 'P1 / P2' }),
          el('span', { class: 'corner-val', text: `${hex8(walk.p1)} ${hex8(walk.p2)}` }),
          el('span', { class: 'corner-role', text: 'chosen plaintexts, differing by alpha' }),
        ]),
        el('div', { class: `corner${live(4) ? ' corner-live' : ''}` }, [
          el('span', { class: 'corner-name', text: 'C1 / C2' }),
          el('span', { class: 'corner-val', text: `${hex8(walk.c1)} ${hex8(walk.c2)}` }),
          el('span', { class: 'corner-role', text: 'what the encryption oracle returned' }),
        ]),
        el('div', { class: `corner${live(5) ? ' corner-live' : ''}` }, [
          el('span', { class: 'corner-name', text: 'C3 / C4' }),
          el('span', { class: 'corner-val', text: `${hex8(walk.c3)} ${hex8(walk.c4)}` }),
          el('span', { class: 'corner-role', text: 'shifted by delta, handed to the decryption oracle' }),
        ]),
        el('div', { class: `corner${live(8) ? ' corner-live' : ''}` }, [
          el('span', { class: 'corner-name', text: 'P3 / P4' }),
          el('span', { class: 'corner-val', text: `${hex8(walk.p3)} ${hex8(walk.p4)}` }),
          el('span', {
            class: 'corner-role',
            text: shown >= 8 ? `difference ${hex8(walk.p3 ^ walk.p4)} -- the boomerang` : 'not yet decrypted',
          }),
        ]),
      ])
    );
  }

  function renderMeasurement(): void {
    clear(measureOut);
    const sbox = getSbox(currentSbox);
    const { ddt, bct } = tablesFor(sbox);
    const rows: SwitchMeasurement[] = SWITCH_CASES.map((c) => measureSwitch(c.beta, c.gamma, sbox, ddt, bct));
    const mine = measureSwitch(currentCase.beta, currentCase.gamma, sbox, ddt, bct);
    const n = caseNumbers(currentCase, currentSbox);

    measureOut.append(
      el('div', { class: 'readout' }, [
        stat(
          'switch measured',
          probLabel(mine.measured),
          `${mine.closed} of ${mine.states} middle states -- every one tried`,
          'accent'
        ),
        stat('round-trip table says', probLabel(mine.bctPrediction), `${mine.bctHigh}/16 x ${mine.bctLow}/16`, mine.matchesBct ? 'good' : 'bad'),
        stat('trail reading says', probLabel(mine.trailPrediction), `(${mine.ddtHigh}/16)2 x (${mine.ddtLow}/16)2`, mine.matchesTrail ? undefined : 'bad'),
        stat(
          'trail reading is out by',
          mine.trailPrediction > 0
            ? `${(mine.measured / mine.trailPrediction).toFixed(0)}x`
            : mine.measured > 0
              ? 'infinitely'
              : 'not at all',
          mine.measured > 0 && mine.trailPrediction === 0 ? 'it predicts never; it happens always' : 'measured / trail',
          mine.matchesTrail ? undefined : 'bad'
        ),
      ])
    );

    measureOut.append(
      verdict(
        mine.matchesBct ? 'pass' : 'fail',
        mine.matchesBct ? 'THE ROUND-TRIP TABLE IS EXACTLY RIGHT' : 'THE ROUND-TRIP TABLE IS WRONG',
        mine.matchesBct
          ? `${mine.closed} of ${mine.states} middle states close the round trip, and the Boomerang Connectivity Table predicts exactly ${mine.closed}. Not approximately: all 256 states were tried, so there is no sampling error to hide in. ${mine.matchesTrail ? 'Here the trail reading happens to agree too.' : `The trail reading predicts ${probLabel(mine.trailPrediction)}, which is not what happens.`}`
          : 'This should be impossible -- the measurement is the table’s own definition applied to both nibbles.',
        'switch-verdict'
      )
    );

    if (mine.measured === 0) {
      measureOut.append(
        verdict(
          'fail',
          `THE SWITCH NEVER CLOSES — ${FAILURE_CODES.SWITCH_INCOMPATIBLE}`,
          `${FAILURE_TEXT.E_SWITCH_INCOMPATIBLE} Zero of 256 middle states. Two trails picked independently can simply refuse to join -- Murphy's 2011 observation -- and p2q2 would have promised ${probLabel(n.p2q2)}.`,
          'switch-incompatible'
        )
      );
    }

    measureOut.append(
      scrollRegion('Every shipped switch case, measured', 'table-wrap', [
        el('table', {}, [
          el('caption', {
            text: 'All four cases, each measured over all 256 middle states. The last column is the ratio the trail reading gets wrong.',
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
    measureOut.append(
      disclosure('The two tables, with this switch’s cells marked', [
        el('p', {}, [
          document.createTextNode(
            `Both are computed from the S-box on this page. The marked cells are (${hex4(bh)}, ${hex4(gh)}) for the high S-box and (${hex4(bl)}, ${hex4(gl)}) for the low one. Rows are the difference going in, columns the difference coming out (one-way) or the shift applied (round trip).`
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
          'Round-trip table (BCT): how many of the 16 inputs let the boomerang go in with this difference, shift by that amount, and come back out with the same difference.',
          'Boomerang connectivity table',
          [
            { row: bh, col: gh, tone: bct[bh][gh] === 0 ? 'bad' : 'ok' },
            { row: bl, col: gl, tone: bct[bl][gl] === 0 ? 'bad' : 'ok' },
          ],
          10
        ),
        el('p', {}, [
          document.createTextNode(
            'Three identities hold for any invertible S-box, and the test suite checks all three by brute force rather than quoting them: the round-trip table’s first row and first column are all 16; every round-trip entry is at least the matching one-way entry; and every round-trip entry is even. The second one has a consequence worth stating plainly -- at a single substitution layer, the round trip can only ever be EASIER than the one-way crossing, never harder. So a switch this narrow cannot be the thing that makes a boomerang rarer than predicted; that needs a wider middle than this page covers.'
          ),
        ]),
      ])
    );
  }

  async function run(sbox: SboxName): Promise<void> {
    currentSbox = sbox;
    const c = currentCase;
    clear(stepsOut);
    stepsOut.append(el('p', { class: 'field-hint', text: 'Searching for a quartet that follows this trail...' }));
    const result = (await compute({
      kind: 'quartet',
      sbox,
      alpha: c.alpha,
      beta: c.beta,
      gamma: c.gamma,
      delta: c.delta,
      rounds: c.rounds,
      switchRound: c.switchRound,
      startKey: 0x0000,
      limit: MASTER_KEY_SPACE,
    })) as QuartetOutcome;
    walk = result.walk;
    steps = walk.found ? walkSteps(c, walk, caseNumbers(c, sbox)) : [];
    shown = walk.found ? 1 : 0;
    clear(quartetOut);
    clear(stepsOut);
    if (!walk.found) {
      stepBtn.disabled = true;
      resetBtn.disabled = true;
      stepsOut.append(
        verdict(
          'fail',
          'NO QUARTET FOLLOWS THIS TRAIL',
          `Every one of the ${num(result.keysTried)} master keys was tried and none produced a quartet in which all four legs of this trail hold at once. ${
            measureSwitch(c.beta, c.gamma, getSbox(sbox), tablesFor(getSbox(sbox)).ddt, tablesFor(getSbox(sbox)).bct)
              .measured === 0
              ? `That is expected here: the round trip closes for none of the 256 middle states (${FAILURE_CODES.SWITCH_INCOMPATIBLE}), so the walk has nothing to show and the page says so rather than showing a quartet that merely looks like the trail.`
              : 'The switch does close for some middle states, but an 8-bit block offers only 128 pairs per key, and four conditions at once can have no common solution in that many. A trail probability is not a promise about any particular key.'
          }`,
          'walk-verdict'
        )
      );
    } else {
      stepBtn.disabled = false;
      resetBtn.disabled = false;
      stepsOut.append(
        el('p', { class: 'field-hint', id: 'walk-key' }, [
          document.createTextNode(
            `Key ${hex16(result.masterKey)}, found after trying ${num(result.keysTried)} of ${num(MASTER_KEY_SPACE)}. Every value below is produced by the real cipher under that key.`
          ),
        ])
      );
      renderQuartet();
      renderSteps();
    }
    renderMeasurement();
  }

  stepBtn.addEventListener('click', () => {
    if (!walk || !walk.found) return;
    if (shown < steps.length) shown += 1;
    stepBtn.disabled = shown >= steps.length;
    renderQuartet();
    renderSteps();
  });
  resetBtn.addEventListener('click', () => {
    shown = 1;
    stepBtn.disabled = false;
    renderQuartet();
    renderSteps();
  });

  for (const [id, btn] of buttons) {
    btn.addEventListener('click', () => {
      currentCase = SWITCH_CASES.find((c) => c.id === id) ?? SWITCH_CASES[0];
      for (const [otherId, other] of buttons) {
        other.setAttribute('aria-pressed', otherId === id ? 'true' : 'false');
      }
      clear(storyOut);
      storyOut.append(el('p', { text: currentCase.story }));
      void run(currentSbox);
      for (const fn of listeners) fn(id);
    });
  }

  const storyOut = el('div', { id: 'switch-story' }, [el('p', { text: SWITCH_CASES[0].story })]);

  const node = el('section', { class: 'card', 'aria-labelledby': 'act5-title', id: 'act5' }, [
    el('div', { class: 'act-head' }, [
      el('span', { class: 'act-num', text: 'ACT 5' }),
      el('h2', { class: 'act-title', id: 'act5-title', text: 'The switch, where the estimate breaks' }),
    ]),
    el('p', { class: 'act-lede' }, [
      document.createTextNode(
        'p2q2 assumes the two halves behave independently, and the place that assumption is tested hardest is the substitution layer where they meet. A trail has to cross it once, in one direction. A boomerang crosses it twice -- out and back -- and those are different questions with different answers. Step one real quartet through it and watch.'
      ),
    ]),
    el('div', { class: 'controls' }, [field('Switch case', caseButtons)]),
    storyOut,
    el('h3', { class: 'subhead', text: 'One real quartet, step by step' }),
    quartetOut,
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
    stepsOut,
    el('h3', { class: 'subhead', text: 'The switch on its own, over every middle state' }),
    el('p', {}, [
      document.createTextNode(
        'The walk shows one quartet. This measures the switch itself: for each of the 256 possible states entering it, does the round trip come back out with the difference it went in with? No sampling and no interval -- every state is tried, so the answer is exact.'
      ),
    ]),
    measureOut,
    callout('caveat', 'Scope', [
      el('p', {}, [
        document.createTextNode(
          'The round-trip table covers ONE substitution layer. That is what Cid, Huang, Peyrin, Sasaki and Song defined in 2018 and it is exactly what the switch above is. Nothing here says anything about a middle section spanning several rounds, where the accounting is harder and later work extends the table; and nothing here claims a general rule about boomerangs on real ciphers.'
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
  };
}
