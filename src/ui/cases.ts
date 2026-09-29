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
  /** What the reader should take from this case. */
  readonly story: string;
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
    story:
      'The forward half leaves the low S-box active and the high one quiet; the backward half does the opposite. Through one substitution in one direction that is flatly impossible -- both DDT entries are zero. The round trip never touches a contradiction, so it costs nothing at all.',
  },
  {
    id: 'amplified',
    label: 'All four S-boxes active: the trail is out by 1600x',
    short: 'Amplified',
    rounds: 3,
    switchRound: 1,
    alpha: 0xbf,
    beta: 0xbf,
    gamma: 0x51,
    delta: 0x05,
    story:
      'No quiet S-box anywhere: both nibbles of both differences are active. The one-way crossing succeeds 2 times in 16 on each nibble, so a trail charges (2/16) squared per nibble. The round trip succeeds 10 times in 16 on each. The switch sits at round 1, so the first half is empty and every bit of the discrepancy belongs to the switch.',
  },
  {
    id: 'control',
    label: 'Control: nothing unusual at the switch',
    short: 'Control',
    rounds: 3,
    switchRound: 2,
    alpha: 0xb0,
    beta: 0x02,
    gamma: 0x05,
    delta: 0xd0,
    story:
      'Here the round-trip table and the one-way table agree entry for entry. The trail estimate is still wrong, and by a factor you can predict: it pays the crossing twice, once going out and once coming back, when the round trip only has to succeed once.',
  },
  {
    id: 'incompatible',
    label: 'Incompatible: the round trip never closes',
    short: 'Incompatible',
    rounds: 3,
    switchRound: 2,
    alpha: 0x0b,
    beta: 0x08,
    gamma: 0x51,
    delta: 0x20,
    story:
      'A round-trip entry of zero. Not unlikely -- impossible, for every one of the 256 middle states. Two trails chosen independently can simply refuse to join, which is the problem Murphy pointed out in 2011.',
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
