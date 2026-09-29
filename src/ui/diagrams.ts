/**
 * The two mechanism diagrams. Both draw the real thing; neither draws a picture
 * the mathematics does not support.
 *
 * MISS IN THE MIDDLE is laid out in HTML rather than SVG on purpose. Its content
 * is two LISTS OF VALUES and the fact that they share nothing -- text a reader
 * needs to read, select and have announced -- so it is a grid that reflows to one
 * column on a phone, not a picture of a grid.
 *
 * THE QUARTET SQUARE is SVG, because its content is a shape: four corners and the
 * six relationships between them. The square is STABLE -- the corners never move
 * as the walk advances -- so the reader tracks one object gaining values rather
 * than a layout rearranging itself. Only the edge and nodes belonging to the
 * current step are highlighted; completed values stay legible, future ones are
 * drawn in the muted ink rather than hidden, because a diagram that pops boxes
 * into existence teaches the animation instead of the mechanism.
 */
import { el, hex8, num, scrollRegion, svg } from './dom.ts';

// ── miss in the middle ──────────────────────────────────────────────────────

export interface MissDiagramData {
  readonly alpha: number;
  readonly delta: number;
  readonly rounds: number;
  readonly forwardLayers: number;
  readonly backwardLayers: number;
  readonly forward: readonly number[];
  readonly backward: readonly number[];
  readonly shared: readonly number[];
  readonly impossible: boolean;
}

function valueChips(values: readonly number[], limit: number, label: string): HTMLElement {
  const shown = values.slice(0, limit);
  const list = el(
    'ul',
    { class: 'chipset', role: 'list', 'aria-label': label },
    shown.map((v) => el('li', { class: 'chip-val', role: 'listitem', text: hex8(v) }))
  );
  if (values.length > limit) {
    list.append(
      el('li', {
        class: 'chip-val chip-more',
        role: 'listitem',
        text: `+${num(values.length - limit)} more`,
      })
    );
  }
  return list;
}

export function missInTheMiddleDiagram(d: MissDiagramData): HTMLElement {
  const verdictText = d.impossible
    ? 'No value appears in both lists'
    : `${num(d.shared.length)} value${d.shared.length === 1 ? '' : 's'} appear in both`;

  const forward = el('div', { class: 'mim-side mim-forward' }, [
    el('span', { class: 'mim-role', text: 'FORWARD, FROM THE INPUT' }),
    el('span', { class: 'mim-end', text: hex8(d.alpha) }),
    el('span', {
      class: 'mim-arrow',
      'aria-hidden': 'true',
      text: '↓',
    }),
    el('span', {
      class: 'mim-step',
      text: `${d.forwardLayers} round${d.forwardLayers === 1 ? '' : 's'}, every possibility`,
    }),
    el('span', {
      class: 'mim-count',
      text: `can reach exactly ${num(d.forward.length)} difference${d.forward.length === 1 ? '' : 's'}`,
    }),
    valueChips(d.forward, 16, 'forward-reachable middle differences'),
  ]);

  const middle = el('div', { class: `mim-middle ${d.impossible ? 'mim-empty' : 'mim-overlap'}` }, [
    el('span', { class: 'mim-gap-mark', 'aria-hidden': 'true', text: d.impossible ? '∅' : '∩' }),
    el('span', { class: 'mim-gap-label', text: verdictText }),
    el('span', {
      class: 'mim-gap-note',
      text: d.impossible
        ? 'so the two halves cannot meet, and the pair can never exist — under any key'
        : 'so a trail joins them and the differential is possible',
    }),
    ...(d.shared.length ? [valueChips(d.shared, 8, 'differences in both lists')] : []),
  ]);

  const backward = el('div', { class: 'mim-side mim-backward' }, [
    el('span', { class: 'mim-role', text: 'BACKWARD, FROM THE OUTPUT' }),
    el('span', { class: 'mim-end', text: hex8(d.delta) }),
    el('span', { class: 'mim-arrow', 'aria-hidden': 'true', text: '↑' }),
    el('span', {
      class: 'mim-step',
      text: `${d.backwardLayers} round${d.backwardLayers === 1 ? '' : 's'}, every possibility`,
    }),
    el('span', {
      class: 'mim-count',
      text: `must have been one of ${num(d.backward.length)} difference${d.backward.length === 1 ? '' : 's'}`,
    }),
    valueChips(d.backward, 16, 'backward-required middle differences'),
  ]);

  return el('div', { class: 'mim' }, [forward, middle, backward]);
}

// ── the quartet square ──────────────────────────────────────────────────────

export interface QuartetNode {
  readonly name: string;
  readonly value: number | null;
}

export interface QuartetDiagramData {
  readonly p1: QuartetNode;
  readonly p2: QuartetNode;
  readonly c1: QuartetNode;
  readonly c2: QuartetNode;
  readonly c3: QuartetNode;
  readonly c4: QuartetNode;
  readonly p3: QuartetNode;
  readonly p4: QuartetNode;
  readonly alpha: number;
  readonly delta: number;
  /** 0 = nothing revealed yet; 1..8 = the step just taken. */
  readonly step: number;
  /** True once the returning difference has been shown to equal alpha. */
  readonly returned: boolean;
}

/** Which nodes and which edge belong to each step of the walk. */
const STEP_NODES: Record<number, readonly string[]> = {
  1: ['p1', 'p2'],
  2: ['p1', 'p2'],
  3: ['p1', 'p2'],
  4: ['c1', 'c2'],
  5: ['c3', 'c4'],
  6: ['c3', 'c4'],
  7: ['p3', 'p4'],
  8: ['p3', 'p4'],
};

const W = 520;
const H = 330;
const COL_L = 110;
const COL_R = 410;
const ROW = { p12: 40, c12: 140, c34: 205, p34: 300 };

function node(
  x: number,
  y: number,
  n: QuartetNode,
  live: boolean,
  known: boolean
): SVGElement[] {
  const fill = live ? 'var(--accent-soft)' : 'var(--surface-2)';
  const stroke = live ? 'var(--accent)' : known ? 'var(--edge)' : 'var(--border)';
  const ink = known ? 'var(--text)' : 'var(--text-muted)';
  return [
    svg('rect', {
      x: x - 46,
      y: y - 17,
      width: 92,
      height: 34,
      rx: 7,
      fill,
      stroke,
      'stroke-width': live ? 2 : 1.25,
    }),
    svg(
      'text',
      { x: x - 38, y: y + 4, class: 'chart-label', fill: 'var(--text-dim)' },
      [document.createTextNode(n.name)]
    ),
    svg(
      'text',
      {
        x: x + 38,
        y: y + 5,
        class: 'chart-label q-val',
        'data-node': n.name.toLowerCase(),
        'text-anchor': 'end',
        fill: ink,
        'font-weight': known ? '700' : '400',
      },
      [document.createTextNode(n.value === null ? '—' : hex8(n.value))]
    ),
  ];
}

function edge(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  label: string,
  live: boolean,
  dashed = false
): SVGElement[] {
  const colour = live ? 'var(--accent)' : 'var(--edge)';
  const mid = { x: (x1 + x2) / 2, y: (y1 + y2) / 2 };
  const horizontal = y1 === y2;
  return [
    svg('line', {
      x1,
      y1,
      x2,
      y2,
      stroke: colour,
      'stroke-width': live ? 2.2 : 1.4,
      'stroke-dasharray': dashed ? '5 4' : undefined,
    }),
    svg(
      'text',
      {
        x: horizontal ? mid.x : mid.x + 8,
        y: horizontal ? mid.y - 6 : mid.y + 4,
        class: 'chart-label',
        'text-anchor': horizontal ? 'middle' : 'start',
        fill: colour,
        'font-weight': live ? '700' : '400',
      },
      [document.createTextNode(label)]
    ),
  ];
}

/**
 * The square. Reading it: the two horizontal edges are the differences the
 * attacker CHOOSES (alpha going in, delta applied to the ciphertexts); the four
 * vertical edges are the cipher, encrypting down the left pair and decrypting
 * back up the right pair. The bottom edge is the question the whole attack asks.
 */
export function quartetSquare(d: QuartetDiagramData): HTMLElement {
  const liveNodes = new Set(STEP_NODES[d.step] ?? []);
  const known = (s: number): boolean => d.step >= s;
  const kids: SVGElement[] = [];

  // Vertical legs, drawn first so the node boxes sit on top of them.
  kids.push(...edge(COL_L, ROW.p12 + 17, COL_L, ROW.c12 - 17, 'encrypt', d.step === 3 || d.step === 4));
  kids.push(...edge(COL_R, ROW.p12 + 17, COL_R, ROW.c12 - 17, 'encrypt', d.step === 3 || d.step === 4));
  kids.push(...edge(COL_L, ROW.c12 + 17, COL_L, ROW.c34 - 17, `XOR ${hex8(d.delta)}`, d.step === 5, true));
  kids.push(...edge(COL_R, ROW.c12 + 17, COL_R, ROW.c34 - 17, `XOR ${hex8(d.delta)}`, d.step === 5, true));
  kids.push(...edge(COL_L, ROW.c34 + 17, COL_L, ROW.p34 - 17, 'decrypt', d.step === 6 || d.step === 7));
  kids.push(...edge(COL_R, ROW.c34 + 17, COL_R, ROW.p34 - 17, 'decrypt', d.step === 6 || d.step === 7));

  // Horizontal differences.
  kids.push(...edge(COL_L + 46, ROW.p12, COL_R - 46, ROW.p12, `alpha = ${hex8(d.alpha)}`, d.step === 1));
  kids.push(
    ...edge(
      COL_L + 46,
      ROW.p34,
      COL_R - 46,
      ROW.p34,
      d.step >= 8 ? (d.returned ? `alpha again = ${hex8(d.alpha)}` : 'not alpha') : 'alpha?',
      d.step >= 8
    )
  );

  kids.push(...node(COL_L, ROW.p12, d.p1, liveNodes.has('p1'), known(1)));
  kids.push(...node(COL_R, ROW.p12, d.p2, liveNodes.has('p2'), known(1)));
  kids.push(...node(COL_L, ROW.c12, d.c1, liveNodes.has('c1'), known(4)));
  kids.push(...node(COL_R, ROW.c12, d.c2, liveNodes.has('c2'), known(4)));
  kids.push(...node(COL_L, ROW.c34, d.c3, liveNodes.has('c3'), known(5)));
  kids.push(...node(COL_R, ROW.c34, d.c4, liveNodes.has('c4'), known(5)));
  kids.push(...node(COL_L, ROW.p34, d.p3, liveNodes.has('p3'), known(7)));
  kids.push(...node(COL_R, ROW.p34, d.p4, liveNodes.has('p4'), known(7)));

  // The switch sits inside the encrypt/decrypt legs; mark it when it is the
  // step under discussion, rather than drawing a path through the whole cipher.
  if (d.step === 2 || d.step === 3 || d.step === 7) {
    kids.push(
      svg('rect', {
        x: COL_L - 70,
        y: ROW.p12 + 40,
        width: COL_R - COL_L + 140,
        height: 20,
        rx: 6,
        fill: 'none',
        stroke: 'var(--warn)',
        'stroke-width': 1.5,
        'stroke-dasharray': '4 3',
      })
    );
    kids.push(
      svg(
        'text',
        {
          x: (COL_L + COL_R) / 2,
          y: ROW.p12 + 54,
          class: 'chart-label',
          'text-anchor': 'middle',
          fill: 'var(--warn)',
        },
        [document.createTextNode('the switch: one substitution layer, crossed twice')]
      )
    );
  }

  const label = d.returned && d.step >= 8
    ? `Boomerang quartet, complete: the plaintext difference came back as ${hex8(d.alpha)}`
    : `Boomerang quartet, step ${d.step} of 8`;

  const node_ = svg(
    'svg',
    {
      class: 'chart',
      viewBox: `0 0 ${W} ${H}`,
      role: 'img',
      'aria-label': label,
      preserveAspectRatio: 'xMidYMid meet',
    },
    kids
  );
  return scrollRegion(label, 'chart-wrap', [node_]);
}
