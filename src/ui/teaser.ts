/**
 * The paradox, above the fold, computed live.
 *
 * The page's most memorable result used to sit eight desktop screens and fifteen
 * phone screens down, behind four acts of build-up. This puts it first: two real
 * table entries side by side, the contradiction between them stated in one line,
 * and a single action that takes the reader into the real exhibit with the walk
 * already started.
 *
 * It computes rather than asserts -- both numbers come from the S-box on the page
 * through the same functions Act 5 uses -- so it cannot drift away from the act
 * it is advertising. If the reader switches S-box, it re-reads.
 */
import { getSbox, type SboxName } from '../crypto/sbox.ts';
import { tablesFor } from '../crypto/tables.ts';
import { measureSwitch } from '../crypto/experiments.ts';
import { SWITCH_CASES } from './cases.ts';
import { clear, el, hex4, hex8 } from './dom.ts';

export interface Teaser {
  readonly node: HTMLElement;
  render(sbox: SboxName): void;
  onStep(fn: () => void): void;
}

export function teaser(): Teaser {
  const body = el('div', { id: 'teaser-body' });
  const stepBtn = el('button', { class: 'btn btn-primary', type: 'button', id: 'teaser-step' }, [
    document.createTextNode('Step one real quartet'),
  ]) as HTMLButtonElement;
  const listeners: (() => void)[] = [];
  stepBtn.addEventListener('click', () => {
    for (const fn of listeners) fn();
  });

  function render(sboxName: SboxName): void {
    const sbox = getSbox(sboxName);
    const { ddt, bct } = tablesFor(sbox);
    const c = SWITCH_CASES[0];
    const m = measureSwitch(c.beta, c.gamma, sbox, ddt, bct);
    const bh = (c.beta >> 4) & 0xf;
    const bl = c.beta & 0xf;
    const oneWayZero = m.ddtHigh === 0 && m.ddtLow === 0;
    const alwaysReturns = m.closed === m.states;

    clear(body);
    body.append(
      el('div', { class: 'teaser-pair' }, [
        el('div', { class: `teaser-cell ${oneWayZero ? 'teaser-never' : ''}` }, [
          el('span', { class: 'teaser-cell-role', text: 'ONE WAY THROUGH' }),
          el('span', { class: 'teaser-cell-val', text: `${m.ddtHigh}/16 and ${m.ddtLow}/16` }),
          el('span', {
            class: 'teaser-cell-note',
            text: oneWayZero
              ? `Difference table, rows ${hex4(bh)} and ${hex4(bl)}. Both zero: this crossing can never happen — for any key.`
              : `Difference table, rows ${hex4(bh)} and ${hex4(bl)}.`,
          }),
        ]),
        el('div', { class: `teaser-cell ${alwaysReturns ? 'teaser-always' : ''}` }, [
          el('span', { class: 'teaser-cell-role', text: 'AND BACK AGAIN' }),
          el('span', { class: 'teaser-cell-val', text: `${m.bctHigh}/16 and ${m.bctLow}/16` }),
          el('span', {
            class: 'teaser-cell-note',
            text: alwaysReturns
              ? `Round-trip table, same rows. Both sixteen: the boomerang crosses it every single time — ${m.closed} of ${m.states} middle states, measured.`
              : `Round-trip table, same rows. ${m.closed} of ${m.states} middle states close, measured.`,
          }),
        ]),
      ])
    );
    body.append(
      el('p', { class: 'teaser-line' }, [
        document.createTextNode(
          oneWayZero && alwaysReturns
            ? `The same substitution layer, the same two differences ${hex8(c.beta)} and ${hex8(c.gamma)}. Impossible in one direction. Certain on the round trip.`
            : `The same substitution layer, the same two differences ${hex8(c.beta)} and ${hex8(c.gamma)} — and the two tables disagree about it.`
        ),
      ])
    );
  }

  const node = el('section', { class: 'card card-teaser', 'aria-labelledby': 'teaser-title', id: 'teaser' }, [
    el('h2', { class: 'teaser-title', id: 'teaser-title', text: 'Impossible one way. Certain on the round trip.' }),
    body,
    el('div', { class: 'teaser-actions' }, [
      stepBtn,
      el('a', { class: 'btn', href: '#act1', id: 'teaser-start' }, [
        document.createTextNode('How can both be true? Start at Act 1'),
      ]),
    ]),
  ]);

  return {
    node,
    render,
    onStep(fn) {
      listeners.push(fn);
    },
  };
}

/**
 * The chapter navigator. A second `<nav>` inside the page content, named
 * distinctly from the shared bar's so `landmark-unique` stays satisfied, and
 * sticky beneath the bar rather than under it -- the offset is measured from the
 * bar at runtime rather than hard-coded, because the bar changes height at
 * 560px and a guessed constant would put this half behind it on a phone.
 */
export const CHAPTERS: readonly { id: string; label: string }[] = [
  { id: 'act1', label: 'Trail dies' },
  { id: 'act2', label: 'Impossible' },
  { id: 'act3', label: 'Key sieve' },
  { id: 'act4', label: 'Boomerang' },
  { id: 'act5', label: 'Switch explains it' },
];

export function chapterNav(): HTMLElement {
  return el('nav', { class: 'chapters', 'aria-label': 'Chapters', id: 'chapters' }, [
    el(
      'ol',
      { class: 'chapter-list', role: 'list' },
      CHAPTERS.map((c, i) =>
        el('li', { class: 'chapter-item', role: 'listitem' }, [
          el('a', { class: 'chapter-link', href: `#${c.id}`, 'data-chapter': c.id }, [
            el('span', { class: 'chapter-num', 'aria-hidden': 'true', text: String(i + 1) }),
            document.createTextNode(c.label),
          ]),
        ])
      )
    ),
  ]);
}

/**
 * Keep the sticky offset correct by measuring the shared bar instead of guessing
 * it. Runs once and on resize; the CSS carries a sane fallback so the page is
 * never broken if this does not run.
 */
export function trackTopbarHeight(): void {
  const bar = document.querySelector('.cl-topbar');
  if (!(bar instanceof HTMLElement)) return;
  const set = (): void => {
    document.documentElement.style.setProperty('--cl-topbar-h', `${Math.round(bar.getBoundingClientRect().height)}px`);
  };
  set();
  if (typeof ResizeObserver === 'function') new ResizeObserver(set).observe(bar);
  else window.addEventListener('resize', set);
}
