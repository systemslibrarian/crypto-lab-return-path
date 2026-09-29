/**
 * Inline SVG charts. No library: three chart shapes, and a dependency that draws
 * them would also style them, which is how a chart stops matching its page.
 *
 * Three rules every chart here follows:
 *  - Each series carries a COLOUR, a DASH PATTERN and a MARKER SHAPE, so it
 *    survives greyscale and deuteranopia (WCAG 1.4.1).
 *  - The SVG is `role="img"` with a real name, and every chart is accompanied by
 *    the same numbers as a table. A picture is not an accessible substitute for
 *    the data, so the data ships too.
 *  - Nothing is drawn that the measurement does not support. A line between two
 *    measured points is an interpolation, and where the quantity is discrete
 *    (candidates surviving a sieve) the line is a STEP, not a slope.
 */
import { el, scrollRegion, svg } from './dom.ts';

export interface Series {
  readonly label: string;
  readonly colorVar: string;
  readonly dash: string;
  readonly marker: 'circle' | 'square' | 'diamond' | 'none';
  readonly points: readonly (number | null)[];
}

const PAD = { top: 14, right: 16, bottom: 30, left: 44 };

function marker(kind: Series['marker'], x: number, y: number, color: string): SVGElement | null {
  const size = 4;
  if (kind === 'circle') return svg('circle', { cx: x, cy: y, r: size, fill: color });
  if (kind === 'square')
    return svg('rect', { x: x - size, y: y - size, width: size * 2, height: size * 2, fill: color });
  if (kind === 'diamond')
    return svg('path', {
      d: `M${x} ${y - size - 1}L${x + size + 1} ${y}L${x} ${y + size + 1}L${x - size - 1} ${y}Z`,
      fill: color,
    });
  return null;
}

export interface LineChartOptions {
  readonly title: string;
  readonly xLabels: readonly string[];
  readonly xTitle: string;
  readonly yTitle: string;
  readonly yMin: number;
  readonly yMax: number;
  readonly series: readonly Series[];
  /** Horizontal reference lines, e.g. "one right pair" or the random floor. */
  readonly rules?: readonly { at: number; label: string; colorVar: string }[];
  readonly width?: number;
  readonly height?: number;
}

export function lineChart(opts: LineChartOptions): HTMLElement {
  const w = opts.width ?? 640;
  const h = opts.height ?? 260;
  const plotW = w - PAD.left - PAD.right;
  const plotH = h - PAD.top - PAD.bottom;
  const n = opts.xLabels.length;
  const xAt = (i: number): number => PAD.left + (n === 1 ? plotW / 2 : (i * plotW) / (n - 1));
  const span = opts.yMax - opts.yMin || 1;
  const yAt = (v: number): number => PAD.top + plotH - ((v - opts.yMin) / span) * plotH;

  const kids: SVGElement[] = [];

  // Y grid, five lines, labelled.
  for (let k = 0; k <= 4; k++) {
    const v = opts.yMin + (span * k) / 4;
    const y = yAt(v);
    kids.push(svg('line', { x1: PAD.left, y1: y, x2: PAD.left + plotW, y2: y, class: 'chart-grid' }));
    kids.push(
      svg('text', { x: PAD.left - 6, y: y + 3.5, class: 'chart-label', 'text-anchor': 'end' }, [
        document.createTextNode(v.toFixed(1)),
      ])
    );
  }
  kids.push(
    svg('line', {
      x1: PAD.left,
      y1: PAD.top,
      x2: PAD.left,
      y2: PAD.top + plotH,
      class: 'chart-axis',
    })
  );
  kids.push(
    svg('line', {
      x1: PAD.left,
      y1: PAD.top + plotH,
      x2: PAD.left + plotW,
      y2: PAD.top + plotH,
      class: 'chart-axis',
    })
  );
  for (let i = 0; i < n; i++) {
    kids.push(
      svg(
        'text',
        { x: xAt(i), y: h - 14, class: 'chart-label', 'text-anchor': 'middle' },
        [document.createTextNode(opts.xLabels[i])]
      )
    );
  }
  kids.push(
    svg('text', { x: PAD.left + plotW / 2, y: h - 2, class: 'chart-label', 'text-anchor': 'middle' }, [
      document.createTextNode(opts.xTitle),
    ])
  );
  kids.push(
    svg(
      'text',
      {
        x: 10,
        y: PAD.top + plotH / 2,
        class: 'chart-label',
        'text-anchor': 'middle',
        transform: `rotate(-90 10 ${PAD.top + plotH / 2})`,
      },
      [document.createTextNode(opts.yTitle)]
    )
  );

  for (const rule of opts.rules ?? []) {
    if (rule.at < opts.yMin || rule.at > opts.yMax) continue;
    const y = yAt(rule.at);
    kids.push(
      svg('line', {
        x1: PAD.left,
        y1: y,
        x2: PAD.left + plotW,
        y2: y,
        stroke: `var(${rule.colorVar})`,
        'stroke-width': 1.5,
        'stroke-dasharray': '2 3',
      })
    );
    kids.push(
      svg(
        'text',
        {
          x: PAD.left + plotW - 2,
          y: y - 4,
          class: 'chart-label',
          'text-anchor': 'end',
          fill: `var(${rule.colorVar})`,
        },
        [document.createTextNode(rule.label)]
      )
    );
  }

  for (const s of opts.series) {
    const color = `var(${s.colorVar})`;
    let d = '';
    s.points.forEach((p, i) => {
      if (p === null) return;
      const clamped = Math.max(opts.yMin, Math.min(opts.yMax, p));
      d += `${d ? 'L' : 'M'}${xAt(i)} ${yAt(clamped)}`;
    });
    if (d) {
      kids.push(
        svg('path', {
          d,
          fill: 'none',
          stroke: color,
          'stroke-width': 2.2,
          'stroke-dasharray': s.dash,
          'stroke-linejoin': 'round',
        })
      );
    }
    s.points.forEach((p, i) => {
      if (p === null) return;
      const clamped = Math.max(opts.yMin, Math.min(opts.yMax, p));
      const m = marker(s.marker, xAt(i), yAt(clamped), color);
      if (m) kids.push(m);
    });
  }

  const node = svg(
    'svg',
    {
      class: 'chart',
      viewBox: `0 0 ${w} ${h}`,
      role: 'img',
      'aria-label': opts.title,
      preserveAspectRatio: 'xMidYMid meet',
    },
    kids
  );
  return chartRegion(opts.title, node);
}

/**
 * A chart is a `min-width: 20rem` SVG inside an `overflow-x: auto` wrapper, so on
 * a phone it genuinely scrolls sideways. A scrolling region holding no focusable
 * content needs `tabindex="0"` to become a focus target arrow keys can scroll
 * (WCAG 2.1.1), and a `role` plus an accessible name so it is announced at all -
 * axe's `scrollable-region-focusable` catches the first and nothing catches the
 * second. The wrapper is named after the chart rather than "chart", so a reader
 * tabbing through nine of them can tell them apart.
 */
function chartRegion(title: string, node: SVGElement): HTMLElement {
  return scrollRegion(title, 'chart-wrap', [node]);
}

/** A step chart: the quantity changes at discrete events and holds between them. */
export function stepChart(opts: {
  title: string;
  values: readonly number[];
  yMax: number;
  xTitle: string;
  yTitle: string;
  markAt?: { index: number; label: string };
  width?: number;
  height?: number;
}): HTMLElement {
  const w = opts.width ?? 640;
  const h = opts.height ?? 220;
  const plotW = w - PAD.left - PAD.right;
  const plotH = h - PAD.top - PAD.bottom;
  const n = Math.max(1, opts.values.length);
  const xAt = (i: number): number => PAD.left + (i * plotW) / n;
  const yAt = (v: number): number => PAD.top + plotH - (v / (opts.yMax || 1)) * plotH;
  const kids: SVGElement[] = [];
  for (let k = 0; k <= 4; k++) {
    const v = (opts.yMax * k) / 4;
    const y = yAt(v);
    kids.push(svg('line', { x1: PAD.left, y1: y, x2: PAD.left + plotW, y2: y, class: 'chart-grid' }));
    kids.push(
      svg('text', { x: PAD.left - 6, y: y + 3.5, class: 'chart-label', 'text-anchor': 'end' }, [
        document.createTextNode(String(Math.round(v))),
      ])
    );
  }
  kids.push(
    svg('line', { x1: PAD.left, y1: PAD.top, x2: PAD.left, y2: PAD.top + plotH, class: 'chart-axis' })
  );
  kids.push(
    svg('line', {
      x1: PAD.left,
      y1: PAD.top + plotH,
      x2: PAD.left + plotW,
      y2: PAD.top + plotH,
      class: 'chart-axis',
    })
  );
  let d = `M${xAt(0)} ${yAt(256)}`;
  opts.values.forEach((v, i) => {
    d += `L${xAt(i)} ${yAt(v)}L${xAt(i + 1)} ${yAt(v)}`;
  });
  kids.push(
    svg('path', {
      d,
      fill: 'none',
      stroke: 'var(--series-measured)',
      'stroke-width': 2.2,
      'stroke-linejoin': 'miter',
    })
  );
  if (opts.markAt && opts.markAt.index >= 0) {
    const x = xAt(opts.markAt.index + 1);
    kids.push(
      svg('line', {
        x1: x,
        y1: PAD.top,
        x2: x,
        y2: PAD.top + plotH,
        stroke: 'var(--good)',
        'stroke-width': 1.5,
        'stroke-dasharray': '3 3',
      })
    );
    kids.push(
      svg(
        'text',
        { x: x - 4, y: PAD.top + 10, class: 'chart-label', 'text-anchor': 'end', fill: 'var(--good)' },
        [document.createTextNode(opts.markAt.label)]
      )
    );
  }
  for (const [i, label] of [
    [0, '0'],
    [Math.floor(n / 2), String(Math.floor(n / 2))],
    [n, String(n)],
  ] as [number, string][]) {
    kids.push(
      svg('text', { x: xAt(i), y: h - 14, class: 'chart-label', 'text-anchor': 'middle' }, [
        document.createTextNode(label),
      ])
    );
  }
  kids.push(
    svg('text', { x: PAD.left + plotW / 2, y: h - 2, class: 'chart-label', 'text-anchor': 'middle' }, [
      document.createTextNode(opts.xTitle),
    ])
  );
  kids.push(
    svg(
      'text',
      {
        x: 10,
        y: PAD.top + plotH / 2,
        class: 'chart-label',
        'text-anchor': 'middle',
        transform: `rotate(-90 10 ${PAD.top + plotH / 2})`,
      },
      [document.createTextNode(opts.yTitle)]
    )
  );
  const node = svg(
    'svg',
    {
      class: 'chart',
      viewBox: `0 0 ${w} ${h}`,
      role: 'img',
      'aria-label': opts.title,
      preserveAspectRatio: 'xMidYMid meet',
    },
    kids
  );
  return chartRegion(opts.title, node);
}

export interface Bar {
  readonly label: string;
  readonly value: number;
  readonly colorVar: string;
  /** A measured bar carries its interval; a prediction is a point and has none. */
  readonly interval?: readonly [number, number];
  readonly hatch?: boolean;
}

/**
 * Horizontal bars on a log2 scale, because the quantities compared span eleven
 * binary orders of magnitude and a linear axis would render three of the four
 * bars as a single pixel.
 *
 * A prediction of EXACTLY zero has no place on a log axis and is not faked onto
 * one: it is drawn as a zero-length bar with the word "never" beside it.
 */
export function barChart(opts: {
  title: string;
  bars: readonly Bar[];
  floor: number;
  width?: number;
}): HTMLElement {
  const w = opts.width ?? 640;
  const rowH = 34;
  const h = PAD.top + opts.bars.length * rowH + 26;
  const left = 150;
  const plotW = w - left - PAD.right;
  const lo = Math.log2(opts.floor);
  const hi = 0;
  const xAt = (v: number): number => {
    if (v <= 0) return left;
    const t = (Math.log2(v) - lo) / (hi - lo);
    return left + Math.max(0, Math.min(1, t)) * plotW;
  };
  const kids: SVGElement[] = [];
  for (let e = Math.ceil(lo); e <= 0; e += 2) {
    const x = xAt(Math.pow(2, e));
    kids.push(svg('line', { x1: x, y1: PAD.top - 4, x2: x, y2: h - 24, class: 'chart-grid' }));
    kids.push(
      svg('text', { x, y: h - 12, class: 'chart-label', 'text-anchor': 'middle' }, [
        document.createTextNode(`2^${e}`),
      ])
    );
  }
  opts.bars.forEach((b, i) => {
    const y = PAD.top + i * rowH;
    kids.push(
      svg('text', { x: left - 8, y: y + 14, class: 'chart-label', 'text-anchor': 'end' }, [
        document.createTextNode(b.label),
      ])
    );
    const x2 = xAt(b.value);
    if (b.value > 0 && x2 > left) {
      kids.push(
        svg('rect', {
          x: left,
          y: y + 3,
          width: x2 - left,
          height: 16,
          fill: `var(${b.colorVar})`,
          'fill-opacity': b.hatch ? 0.45 : 1,
          stroke: `var(${b.colorVar})`,
          'stroke-width': 1.5,
        })
      );
    } else {
      kids.push(
        svg('text', { x: left + 4, y: y + 15, class: 'chart-label', fill: `var(${b.colorVar})` }, [
          document.createTextNode('never (exactly 0)'),
        ])
      );
    }
    if (b.interval) {
      const a = xAt(b.interval[0]);
      const c = xAt(b.interval[1]);
      kids.push(
        svg('line', {
          x1: a,
          y1: y + 11,
          x2: c,
          y2: y + 11,
          stroke: 'var(--text)',
          'stroke-width': 1.5,
        })
      );
      for (const x of [a, c]) {
        kids.push(
          svg('line', { x1: x, y1: y + 5, x2: x, y2: y + 17, stroke: 'var(--text)', 'stroke-width': 1.5 })
        );
      }
    }
  });
  const node = svg(
    'svg',
    {
      class: 'chart',
      viewBox: `0 0 ${w} ${h}`,
      role: 'img',
      'aria-label': opts.title,
      preserveAspectRatio: 'xMidYMid meet',
    },
    kids
  );
  return chartRegion(opts.title, node);
}

export function legend(items: readonly { label: string; colorVar: string; dash?: string }[]): HTMLElement {
  return el(
    'ul',
    { class: 'legend', role: 'list' },
    items.map((i) =>
      el('li', { class: 'legend-item', role: 'listitem' }, [
        el('span', {
          class: 'legend-swatch',
          'aria-hidden': 'true',
          style: `border-top-color: var(${i.colorVar}); border-top-style: ${
            i.dash === 'none' || !i.dash ? 'solid' : 'dashed'
          };`,
        }),
        document.createTextNode(i.label),
      ])
    )
  );
}
