/** Small typed DOM helpers. No framework; the page is a handful of panels. */

type Attrs = Record<string, string | number | boolean | undefined>;

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  children: (Node | string)[] = []
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === false) continue;
    if (k === 'class') node.className = String(v);
    else if (k === 'text') node.textContent = String(v);
    else node.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of children) node.append(typeof c === 'string' ? document.createTextNode(c) : c);
  return node;
}

const SVG_NS = 'http://www.w3.org/2000/svg';

export function svg(tag: string, attrs: Attrs = {}, children: Node[] = []): SVGElement {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === false) continue;
    node.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of children) node.append(c);
  return node;
}

export function clear(node: Element): void {
  while (node.firstChild) node.removeChild(node.firstChild);
}

/** A byte as two lowercase hex digits with an 0x prefix. */
export function hex8(n: number): string {
  return `0x${(n & 0xff).toString(16).padStart(2, '0')}`;
}

/** A 16-bit value as four hex digits. */
export function hex16(n: number): string {
  return `0x${(n & 0xffff).toString(16).padStart(4, '0')}`;
}

/** A nibble as one hex digit, no prefix -- for table headers. */
export function hex4(n: number): string {
  return (n & 0xf).toString(16);
}

export function bits8(n: number): string {
  return (n & 0xff).toString(2).padStart(8, '0');
}

/**
 * A probability as a power of two, the unit a cryptanalyst reads. Exact zero is
 * printed as 0, not as -Infinity.
 */
export function log2Label(p: number): string {
  if (p <= 0) return '0 (exactly)';
  return `2^${Math.log2(p).toFixed(2)}`;
}

/** A probability as a decimal and as a power of two together. */
export function probLabel(p: number): string {
  if (p <= 0) return '0 (exactly)';
  return `${p.toExponential(3)} = ${log2Label(p)}`;
}

/** "1 in 28" -- the form that reads without a logarithm. */
export function oneInLabel(p: number): string {
  if (p <= 0) return 'never';
  return `1 in ${(1 / p).toFixed(1)}`;
}

export function pctLabel(p: number): string {
  return `${(p * 100).toFixed(2)}%`;
}

export function num(n: number): string {
  return n.toLocaleString('en-US');
}

/** Parse a hex or decimal byte from a text field. Returns null on anything else. */
export function parseByte(raw: string): number | null {
  const s = raw.trim().toLowerCase().replace(/^0x/, '');
  if (!/^[0-9a-f]{1,2}$/.test(s)) return null;
  return parseInt(s, 16) & 0xff;
}

export type VerdictTone = 'pass' | 'fail' | 'alarm' | 'info';

const TONE_ICON: Record<VerdictTone, string> = {
  pass: '✓',
  fail: '✕',
  alarm: '⚠',
  info: '·',
};

/**
 * A verdict carries an ICON, a WORD and a COLOUR. All three, always: colour
 * alone fails WCAG 1.4.1, and the colour here tracks system integrity rather
 * than the raw return value -- "impossible one way and the boomerang still
 * returns" is an alarm, not a success, even though every check in it passed.
 *
 * The glyph is `aria-hidden` because the label beside it says the same thing in
 * words; a reader would otherwise hear "check mark impossible".
 */
export function verdict(
  tone: VerdictTone,
  label: string,
  note?: string,
  extraClass?: string
): HTMLElement {
  const body = el('span', { class: 'verdict-body' }, [
    el('span', { class: 'verdict-label', text: label }),
  ]);
  if (note) body.append(el('span', { class: 'verdict-note', text: note }));
  return el('div', { class: `verdict verdict-${tone}${extraClass ? ` ${extraClass}` : ''}` }, [
    el('span', { class: 'verdict-icon', 'aria-hidden': 'true', text: TONE_ICON[tone] }),
    body,
  ]);
}

export function stat(
  key: string,
  value: string,
  sub?: string,
  tone?: 'accent' | 'good' | 'bad' | 'warn'
): HTMLElement {
  const children: Node[] = [
    el('span', { class: 'stat-key', text: key }),
    el('span', { class: 'stat-val', text: value }),
  ];
  if (sub) children.push(el('span', { class: 'stat-sub', text: sub }));
  return el('div', { class: `stat${tone ? ` stat-${tone}` : ''}` }, children);
}

export function callout(
  variant: 'note' | 'caveat' | 'danger',
  label: string,
  body: (Node | string)[]
): HTMLElement {
  return el('div', { class: `callout callout-${variant}` }, [
    el('span', { class: 'callout-label', text: label }),
    ...body,
  ]);
}

export function disclosure(summary: string, body: (Node | string)[]): HTMLDetailsElement {
  const d = el('details', {}, [el('summary', { text: summary })]);
  d.append(el('div', { class: 'details-body' }, body));
  return d as HTMLDetailsElement;
}

export function field(
  labelText: string,
  control: HTMLElement,
  hint?: string
): HTMLElement {
  const wrap = el('div', { class: 'field' });
  const label = el('label', { for: control.id, text: labelText });
  wrap.append(label, control);
  if (hint) wrap.append(el('span', { class: 'field-hint', text: hint }));
  return wrap;
}

/**
 * A wide region that scrolls sideways needs a keyboard route to scroll it
 * (WCAG 2.1.1) and a name to announce it: `tabindex="0"` plus `role="region"`
 * plus a label. The Linux CI runner fails this even where local Chromium passes.
 */
export function scrollRegion(label: string, cls: string, children: Node[]): HTMLElement {
  return el('div', { class: cls, role: 'region', tabindex: '0', 'aria-label': label }, children);
}
