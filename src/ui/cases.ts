/**
 * The boomerang configurations this page ships, with every number derived from
 * the tables rather than typed in.
 *
 * All four put the switch at ONE substitution layer, because that is the only
 * thing the basic Boomerang Connectivity Table covers (Cid et al., EUROCRYPT
 * 2018). Nothing here generalises it to a multi-round middle.
 *
 * `switchRound` is 1-based. E0 is the rounds before it (so `switchRound = 1`
 * means E0 is empty and beta = alpha); E1 is the rounds after it (so
 * `switchRound = rounds` means E1 is empty and delta = gamma).
 */
import { getSbox, type SboxName } from '../crypto/sbox.ts';
import { layerProbability, switchProbabilityBCT, switchProbabilityTrail, tablesFor } from '../crypto/tables.ts';
import { permute, permuteInverse } from '../crypto/permutation.ts';
import { roundTables } from '../crypto/trails.ts';

export interface SwitchCase {
  readonly id: string;
  readonly label: string;
  readonly short: string;
  readonly rounds: number;
  readonly switchRound: number;
  readonly alpha: number;
  readonly beta: number;
  readonly gamma: number;
  readonly delta: number;
}

export const SWITCH_CASES: readonly SwitchCase[] = [
  {
    id: 'ladder',
    label: 'Disjoint S-boxes: the trail says impossible',
    short: 'Disjoint',
    rounds: 3,
    switchRound: 2,
    alpha: 0x0b,
    beta: 0x08,
    gamma: 0x10,
    delta: 0x50,
  },
  {
    id: 'amplified',
    label: 'All four S-boxes active',
    short: 'Amplified',
    rounds: 3,
    switchRound: 1,
    alpha: 0xbf,
    beta: 0xbf,
    gamma: 0x51,
    delta: 0x05,
  },
  {
    id: 'control',
    label: 'Control: compare the two tables',
    short: 'Control',
    rounds: 3,
    switchRound: 2,
    alpha: 0xb0,
    beta: 0x02,
    gamma: 0x05,
    delta: 0xd0,
  },
  {
    id: 'incompatible',
    label: 'Compatibility check',
    short: 'Compatibility',
    rounds: 3,
    switchRound: 2,
    alpha: 0x0b,
    beta: 0x08,
    gamma: 0x51,
    delta: 0x20,
  },
];

export interface CaseNumbers {
  readonly p: number;
  readonly q: number;
  readonly e0Layers: number;
  readonly e1Layers: number;
  /** The difference entering the S-box layer after the switch. */
  readonly afterSwitch: number;
  /** The S-box-layer output difference E0 must produce, before the permutation. */
  readonly beforeSwitch: number;
  readonly switchTrail: number;
  readonly switchBct: number;
  readonly ddtHigh: number;
  readonly ddtLow: number;
  readonly bctHigh: number;
  readonly bctLow: number;
  /** p^2 q^2, ignoring the switch entirely. */
  readonly p2q2: number;
  /** p^2 q^2 with the switch paid as a trail crossing, twice: Wagner's estimate. */
  readonly trailEstimate: number;
  /** p^2 q^2 with the switch paid once, from the round-trip table: the BCT estimate. */
  readonly bctEstimate: number;
}

/** The story follows both controls; the weak-box example is not universal. */
export function caseStory(c: SwitchCase, sboxName: SboxName, switchRound = c.switchRound): string {
  const n = caseNumbers(c, sboxName, switchRound);
  const closed = n.bctHigh * n.bctLow;
  const crossing = `For the selected S-box, the one-way entries are ${n.ddtHigh}/16 and ${n.ddtLow}/16; the round-trip entries are ${n.bctHigh}/16 and ${n.bctLow}/16.`;
  const result = closed === 0
    ? 'The round trip closes for none of the 256 middle states: this switch is incompatible.'
    : n.switchTrail === 0
      ? `The one-way crossing is impossible, while the round trip closes for ${closed} of 256 middle states.`
      : `The round trip closes for ${closed} of 256 middle states, ${(n.switchBct / n.switchTrail).toFixed(1)} times the twice-paid one-way estimate.`;
  const halves = `The switch is at round ${switchRound}: ${n.e0Layers} substitution layer${n.e0Layers === 1 ? '' : 's'} before it and ${n.e1Layers} after it. ${n.e0Layers === 0 ? 'The first half is empty. ' : ''}${n.e1Layers === 0 ? 'The second half is empty. ' : ''}${n.p === 0 || n.q === 0 ? 'One stated half has no trail at this split.' : 'The full quartet must also satisfy both outer halves.'}`;
  return `${crossing} ${result} ${halves}`;
}

const tableCache = new Map<SboxName, ReturnType<typeof roundTables>>();

function tablesOf(sbox: SboxName): ReturnType<typeof roundTables> {
  let t = tableCache.get(sbox);
  if (!t) {
    t = roundTables(tablesFor(getSbox(sbox)).ddt, 6);
    tableCache.set(sbox, t);
  }
  return t;
}

/**
 * The numbers for a case, optionally with the switch moved to a different round.
 *
 * Moving it is the brief's split-point control, and it is genuinely informative:
 * the same two middle differences cost different amounts depending on how many
 * substitution layers sit on each side of them, and at some positions one half
 * has no trail at all -- which the page then says, rather than printing a zero.
 */
export function caseNumbers(c: SwitchCase, sboxName: SboxName, switchRound = c.switchRound): CaseNumbers {
  const { ddt, bct } = tablesFor(getSbox(sboxName));
  const all = tablesOf(sboxName);
  const e0Layers = switchRound - 1;
  const e1Layers = c.rounds - switchRound;
  const beforeSwitch = permuteInverse(c.beta);
  const afterSwitch = permute(c.gamma);
  const p =
    e0Layers === 0 ? (c.alpha === c.beta ? 1 : 0) : all[e0Layers - 1].trail[c.alpha][beforeSwitch];
  const q =
    e1Layers === 0 ? (c.gamma === c.delta ? 1 : 0) : all[e1Layers - 1].trail[afterSwitch][c.delta];
  const switchTrail = switchProbabilityTrail(ddt, c.beta, c.gamma);
  const switchBct = switchProbabilityBCT(bct, c.beta, c.gamma);
  const p2q2 = p * p * q * q;
  const bh = (c.beta >> 4) & 0xf;
  const bl = c.beta & 0xf;
  const gh = (c.gamma >> 4) & 0xf;
  const gl = c.gamma & 0xf;
  return {
    p,
    q,
    e0Layers,
    e1Layers,
    afterSwitch,
    beforeSwitch,
    switchTrail,
    switchBct,
    ddtHigh: ddt[bh][gh],
    ddtLow: ddt[bl][gl],
    bctHigh: bct[bh][gh],
    bctLow: bct[bl][gl],
    p2q2,
    trailEstimate: p2q2 * switchTrail,
    bctEstimate: p2q2 * switchBct,
  };
}

/** Sanity: the one-round crossing probability the page quotes for a half. */
export const crossing = layerProbability;
