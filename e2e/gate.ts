import AxeBuilder from '@axe-core/playwright';
import { expect, type Page } from '@playwright/test';
import { auditContrast, formatContrastFailures } from './contrast';
import { auditNonText } from './nontext';
import { NONTEXT_BASELINE } from './nontext-baseline';

export const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

/** A phone-width viewport, for the WCAG 1.4.10 reflow half of the gate. */
export const NARROW = { width: 380, height: 800 };

/**
 * Shared machinery for the WCAG gate.
 *
 * Five rules govern everything here, and each one corrects something the gate
 * this fleet used to ship:
 *
 *  1. NOTHING IS INJECTED INTO THE PAGE BEFORE A SCAN. The old spec pushed
 *     `animation:none!important; transition:none!important` through
 *     `addStyleTag`. That BYPASSES this lab's own
 *     `@media (prefers-reduced-motion: reduce)` block instead of exercising it.
 *     That matters here: the quartet walk's `.step-line[data-state="current"]`
 *     rides a `reveal` keyframe that starts at `opacity: 0`, and the
 *     reduced-motion block cancels the animation AND restores `opacity: 1`.
 *     Injecting `animation: none` would kill the reveal without restoring
 *     anything, and every revealed step would be SCANNED INVISIBLE. This gate
 *     sets the preference through `emulateMedia`, asserts from inside the page
 *     that it took effect (`test.use({ reducedMotion })` silently does nothing
 *     on Playwright 1.61.x), and injects nothing.
 *
 *  2. IT FORCED EVERY PANEL VISIBLE FROM SCRIPT. The old drive stripped every
 *     `[hidden]` attribute and set every `<details>.open` by JS before its only
 *     scan. Script-opening a disclosure means the SHUT state, which is what
 *     every reader arrives at, was never scanned at all. This lab has eight
 *     disclosures and they all ship shut; this gate opens each through its
 *     `<summary>`, which is the route a reader has, and scans before and after.
 *
 *  3. IT DROVE BLIND AND THEN THREW THE STATES AWAY. The old drive clicked every
 *     button whose label matched a regex, swallowed every failure with
 *     `.catch(() => {})`, waited a fixed 120ms, and scanned ONCE at the end. On
 *     this page that would be fatal in a specific way: every panel renders
 *     ASYNCHRONOUSLY from a Worker, so a fixed wait scans five empty regions and
 *     passes having checked nothing. This drive names every control it touches,
 *     waits on a real completion signal after each, and scans after every step.
 *
 *  4. `violations` IS NOT THE WHOLE ORACLE. See `scan`. The surfaces that carry
 *     this lab's meaning are `color-mix()` fills axe files under `incomplete`
 *     rather than judging: `--accent-soft` on every live quartet corner and
 *     active nibble, the hero aside's accent wash, and the shared bar's ink. So
 *     is an `aria-label` on a role-less element, which this page leans on for
 *     nine labelled regions.
 *
 *  5. IT HAD NO REFLOW, NON-TEXT-CONTRAST OR GENERATED-CONTENT ORACLE. This lab
 *     needs all three. Two 16x16 tables and three SVG charts mean 1.4.10 reflow
 *     is a live risk at 380px; `--edge` versus `--border` is a 1.4.11 claim that
 *     has to be measured; and the `+`/`-` disclosure markers and `!` honesty
 *     bullets are author `content`, which only `nontext.ts` can see.
 */

/**
 * Wait for every running animation and transition to drain.
 *
 * Two rAFs are not enough. A transition sampled mid-flight has a colour that
 * exists in no state of the page, and axe will happily report it: elsewhere in
 * this fleet that produced a phantom 2.00:1 failure on a button whose settled
 * ratio is 9:1. Transitions also drain in waves rather than in one batch, so a
 * poll for "nothing running right now" can exit through a gap between waves —
 * hence six consecutive quiet frames rather than one.
 *
 * Bounded three ways, because a gate that can hang is a gate nobody runs:
 * animations that never finish (`iterations: Infinity`) are excluded from the
 * quiescence test rather than waited on, a wall-clock budget inside the page
 * gives up and proceeds, and Playwright's own timeout is the backstop.
 *
 * Under the reduced motion this gate asserts, `style.css`'s reduced-motion
 * block cancels the `reveal` animation on the quartet walk's current step and
 * shrinks every transition to 0.01ms, so `getAnimations()` is normally empty and
 * this returns on the sixth frame. It stays because the shared top bar's
 * `.cl-btn` transitions are declared OUTSIDE the lab's `@media` block, and
 * because the panels repaint asynchronously as Worker results land.
 */
export async function settle(page: Page, budgetMs = 4000): Promise<void> {
  await page.waitForFunction(
    (budget: number) => {
      const w = window as unknown as { __quietFrames?: number; __settleStart?: number };
      if (w.__settleStart === undefined) w.__settleStart = performance.now();
      const done = (): boolean => {
        w.__quietFrames = 0;
        w.__settleStart = undefined;
        return true;
      };
      const running = document.getAnimations().filter((a) => {
        if (a.playState !== 'running') return false;
        const timing = a.effect?.getComputedTiming?.();
        // An infinite decorative animation never drains; waiting on it hangs.
        return timing?.iterations !== Infinity;
      });
      w.__quietFrames = running.length === 0 ? (w.__quietFrames ?? 0) + 1 : 0;
      if (w.__quietFrames >= 6) return done();
      if (performance.now() - (w.__settleStart ?? 0) > budget) return done();
      return false;
    },
    budgetMs,
    { timeout: 20_000, polling: 'raf' }
  );
}

/**
 * Assert that reduced motion left the page visible, not merely un-animated.
 *
 * The failure mode this guards against is an element whose only route to its
 * visible state is an animation, in a stylesheet whose reduced-motion block
 * cancels that animation without restoring its end state - the element then
 * renders at `opacity: 0` for every reader with the preference set. This lab has
 * EXACTLY that shape: `@keyframes reveal` starts `from { opacity: 0 }` and every
 * newly-revealed step of the quartet walk rides it. The reduced-motion block
 * cancels it with `animation: none` and then restores `opacity: 1` explicitly,
 * which is correct today; this assertion is what makes that a measurement rather
 * than a reading.
 *
 * `aria-hidden` subtrees are excluded; what this lab hides is verdict marks and
 * step marks sitting beside their own words - see `contrast.ts`.
 */
async function expectNotBlank(page: Page, label: string): Promise<void> {
  const invisible = await page.evaluate(() => {
    const out: string[] = [];
    for (const el of Array.from(document.querySelectorAll('body *'))) {
      const own = Array.from(el.childNodes)
        .filter((n) => n.nodeType === Node.TEXT_NODE)
        .map((n) => n.textContent ?? '')
        .join('')
        .trim();
      if (!own) continue;
      // Deliberately hidden subtrees are not "blank", they are closed.
      if (!(el as HTMLElement).checkVisibility?.({ checkVisibilityCSS: true })) continue;
      if (el.closest('[aria-hidden="true"]')) continue;
      let effective = 1;
      let node: Element | null = el;
      while (node) {
        effective *= parseFloat(getComputedStyle(node).opacity);
        node = node.parentElement;
      }
      if (effective === 0) {
        out.push(`${el.tagName.toLowerCase()}.${(el.getAttribute('class') ?? '').trim()}`);
      }
    }
    return Array.from(new Set(out));
  });
  expect(invisible, `no visible text may render at opacity 0 in state: ${label}`).toEqual([]);
}

/**
 * Uncaught page errors and console errors, collected from the moment the page
 * is created.
 *
 * This is load-bearing here rather than belt-and-braces. Every panel on this
 * page is filled by a Worker message; if the Worker throws, or fails to load
 * under the project subpath, the panel is left holding its "Measuring..."
 * placeholder or nothing at all - and an empty region is exactly what a scan
 * reports as perfectly accessible. Attach before `boot`, assert after the drive.
 */
export function watchPageErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console.error: ${m.text()}`);
  });
  return errors;
}

/**
 * Exactly one banner landmark.
 *
 * The shared `.cl-topbar` carries an explicit `role="banner"`. This lab's own
 * hero is a `<div class="cl-hero">`, not a `<header>`, so nothing here implies a
 * second banner today - but the lab DOES ship a `<footer>` appended to `<body>`,
 * and the shared bar's `dedupeBanner()` exists because other labs in this fleet
 * shipped a second `<header>`. Asserting the OUTCOME rather than the markup is
 * what catches a hero re-templated from a lab that uses `<header>`.
 */
export async function assertSingleBanner(page: Page): Promise<void> {
  const banners = await page.evaluate(() => {
    const scoped = new Set(['MAIN', 'ARTICLE', 'ASIDE', 'NAV', 'SECTION']);
    const isBanner = (el: Element): boolean => {
      if (el.getAttribute('role') === 'banner') return true;
      if (el.tagName !== 'HEADER') return false;
      if (el.getAttribute('role')) return false; // explicit non-banner role wins
      for (let p = el.parentElement; p; p = p.parentElement) if (scoped.has(p.tagName)) return false;
      return true;
    };
    return [...document.querySelectorAll('header,[role="banner"]')].filter(isBanner).length;
  });
  expect(banners, 'exactly one banner landmark').toBe(1);
}

/**
 * List semantics survive their styling.
 *
 * This lab styles two kinds of list with `list-style: none` - `.refs` and
 * `.honest-list` - which is exactly the declaration that makes Safari and
 * VoiceOver DROP a list's implicit role. Every one of them carries an explicit
 * `role="list"` with `role="listitem"` children, so here, unlike most of this
 * fleet, an explicit role on a list is the fix rather than the defect. There are
 * nine such lists: the reference lists in Act 6, the honesty panel, the chart
 * legend, the quartet recipe in Act 4, and the nibble strips in Acts 2, 3 and 5.
 *
 * What is asserted is therefore the SHAPE of that fix: any explicit role on a
 * `ul`/`ol` must be `list` (any other value orphans every `<li>` under it), and
 * a `role="list"` must never sit on an empty element, because axe applies
 * `aria-required-children` to the explicit role and fails it the day a nibble
 * strip renders with nothing in it - which happens the moment a reader picks a
 * differential with no impossible differences. Roles are assigned in an
 * element-creation helper, so ask the DOM rather than grepping the source.
 */
export async function assertListSemantics(page: Page): Promise<void> {
  const broken = await page.$$eval('ul[role], ol[role]', (els) =>
    els
      .filter((e) => e.getAttribute('role') !== 'list' || e.children.length === 0)
      .map(
        (e) =>
          `${e.tagName.toLowerCase()}[role=${e.getAttribute('role')}] with ${e.children.length} children`
      )
  );
  expect(
    broken,
    'an explicit non-list role on a list deletes its semantics; an empty role="list" fails aria-required-children'
  ).toEqual([]);
}

/**
 * Load the page with reduced motion actually in effect, and assert the content
 * every scan relies on is really on the page - including the lab's DEFAULTS,
 * which are never assumed.
 *
 * `test.use({ reducedMotion })` silently does nothing on Playwright 1.61.x, so
 * the emulation is applied imperatively BEFORE the navigation and then
 * *asserted* from inside the page. Nothing in this lab's JS branches on
 * `matchMedia`, but the CSS reduced-motion block is the only thing standing
 * between a scan and the quartet walk's mid-flight `reveal` opacities, so the
 * assertion is the difference between scanning the reduced-motion rendering and
 * merely believing we did.
 *
 * Dark is the only theme here, stamped literally on `<html>` in the markup AND
 * pinned by the head's anti-flash script. The script writes `localStorage`'s
 * `theme` key and nothing else; this boot asserts both the attribute and that
 * the key really was written, so a stylesheet that grew a
 * `prefers-color-scheme` block or a script that stopped running would fail here
 * rather than quietly scanning a rendering no reader gets.
 *
 * THE DEFAULTS ARE ASSERTED AT LENGTH, and on this page that is the assertion
 * that matters most. Every one of the five measuring panels is filled
 * ASYNCHRONOUSLY from a Worker. A navigation that resolves proves nothing: until
 * the first message lands, each panel holds a one-line "Measuring..."
 * placeholder, and a scan at that moment measures five placeholders and passes
 * having checked nothing this lab exists to show. So the boot waits for a real
 * verdict in every panel, and asserts the shipped numbers - which also pins the
 * arrival state against a silent change in a default.
 */
export async function boot(page: Page, theme: 'dark' | 'light'): Promise<void> {
  // A click on a control that never becomes actionable otherwise burns the
  // whole test timeout and reports nothing useful. 20s turns that silent hang
  // into a named failure naming the locator.
  page.setDefaultTimeout(20_000);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('.');
  expect(
    await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches),
    'reduced-motion emulation must actually be in effect'
  ).toBe(true);
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
  expect(
    await page.evaluate(() => {
      try {
        return localStorage.getItem('theme');
      } catch {
        return null;
      }
    }),
    "the head's anti-flash script must have written the theme key"
  ).toBe('dark');
  await assertSingleBanner(page);
  await assertListSemantics(page);

  // ── The page really rendered ────────────────────────────────────────────
  await expect(page.locator('main')).toHaveCount(1);
  await expect(page.locator('h1')).toHaveCount(1);
  await expect(page.locator('h1')).toHaveText('Return Path');
  await expect(page.locator('.scripture-footer')).toHaveCount(1);

  // The shared skip link points at an id that exists. axe's skip-link rule is
  // best-practice, not WCAG-tagged, so `withTags` never runs it - a skip link
  // aimed at a missing element is exactly the kind of thing a green axe run
  // says nothing about.
  await expect(page.locator('a.cl-skip-link')).toHaveAttribute('href', '#app');
  await expect(page.locator('#app')).toHaveCount(1);

  // Dark is the only theme, so the page must carry no theme control at all -
  // not the shared bar's, which was removed, and not a lab-local one. The
  // shared CSS hides any lab toggle with `display:none !important`, which would
  // leave a dead-but-known element; asserting the count at zero catches the day
  // one is added without going through that list.
  await expect(
    page.locator('#theme-toggle, #themeToggle, .theme-toggle, .theme-toggle-btn, [data-theme-toggle]')
  ).toHaveCount(0);
  await expect(page.locator('#cl-theme-toggle')).toHaveCount(0);

  // ── Every measuring panel has actually reported ─────────────────────────
  // Not "has rendered": has a VERDICT. Each of these replaces a "Measuring..."
  // placeholder, so waiting on them is waiting on the Worker round trip.
  await expect(page.locator('#decay-out .verdict')).toHaveCount(2);
  await expect(page.locator('#imp-out .verdict')).toHaveCount(1);
  await expect(page.locator('#sieve-out .verdict')).toHaveCount(2);
  await expect(page.locator('#boom-out .verdict')).toHaveCount(2);
  await expect(page.locator('#switch-out .verdict')).toHaveCount(1);
  await expect(page.locator('#walk-out .step-line')).toHaveCount(8);

  // ── The shipped defaults, named ─────────────────────────────────────────
  await expect(page.locator('#global-sbox')).toHaveValue('weak');
  await expect(page.locator('#decay-keys')).toHaveValue('256');
  await expect(page.locator('#imp-alpha')).toHaveValue('0x0a');
  await expect(page.locator('#imp-delta')).toHaveValue('0x01');
  await expect(page.locator('#imp-keys')).toHaveValue('256');
  await expect(page.locator('#sieve-alphas')).toHaveValue('4,10');
  await expect(page.locator('#sieve-key')).toHaveValue(/^0x[0-9a-f]{4}$/);
  await expect(page.locator('#boom-keys')).toHaveValue('512');
  await expect(page.locator('.seg-btn[aria-pressed="true"]')).toHaveCount(1);
  await expect(page.locator('.seg-btn[aria-pressed="true"]')).toHaveAttribute('data-case', 'ladder');

  // The arrival verdicts themselves. Act 2 must read IMPOSSIBLE; Act 5's switch
  // must report the round-trip table exactly right. If either flipped, the page
  // would still render and still scan clean.
  await expect(page.locator('#imp-out .verdict-pass .verdict-label')).toContainText('IMPOSSIBLE');
  await expect(page.locator('#switch-out .verdict-pass .verdict-label')).toContainText(
    'ROUND-TRIP TABLE IS EXACTLY RIGHT'
  );

  // ── Disclosures ship shut ───────────────────────────────────────────────
  // Seven of them. The gate this replaces opened every one from script before
  // its only scan, so the shut state - which is what every reader arrives at -
  // was never scanned.
  await expect(page.locator('details')).toHaveCount(7);
  await expect(page.locator('details[open]')).toHaveCount(0);

  await settle(page);
  await expectNotBlank(page, `${theme} first paint`);
}

/**
 * Assert the page does not require horizontal scrolling.
 *
 * WCAG 1.4.10 (Reflow, AA). axe has no rule for this at all, and this lab is
 * full of things that want to be wider than a phone: two 16x16 tables, three SVG
 * charts with a `min-width: 20rem`, eight-column results tables, and nibble
 * strips that can run to thirty chips. Each of those is inside a `.table-wrap` or
 * `.chart-wrap` with `overflow-x: auto`, so each is allowed to be wide - the
 * DOCUMENT is not. The shapes at risk are a chart that escapes its wrapper, a
 * `.readout` grid whose automatic minimum size is a long monospace run, or a new
 * table added without a wrapper. At 380px that is precisely what this catches,
 * and the `clipped()` walk below is what keeps it from blaming a table for its
 * own scroller.
 */
export async function expectNoHorizontalOverflow(page: Page, label: string): Promise<void> {
  const overflow = await page.evaluate(() => {
    const doc = document.documentElement;
    if (doc.scrollWidth <= doc.clientWidth) return null;

    // Only elements that actually push the DOCUMENT sideways are culprits. A
    // wide box inside an `overflow: auto` wrapper has a huge bounding rect but
    // is clipped by its scroller and contributes nothing to the document's
    // scroll width — naming it sends you off fixing the wrong element.
    const clipped = (el: Element): boolean => {
      let n = el.parentElement;
      while (n && n !== doc) {
        const ox = getComputedStyle(n).overflowX;
        if (ox === 'auto' || ox === 'scroll' || ox === 'hidden' || ox === 'clip') return true;
        n = n.parentElement;
      }
      return false;
    };

    const over = Array.from(document.querySelectorAll('body *'))
      .map((el) => ({ el, r: el.getBoundingClientRect() }))
      .filter((x) => x.r.width > 0 && x.r.right > doc.clientWidth + 1)
      .sort((a, b) => b.r.right - a.r.right);
    const widest = over.filter((x) => !clipped(x.el))[0] ?? over[0];
    return {
      scrollWidth: doc.scrollWidth,
      clientWidth: doc.clientWidth,
      widest: widest
        ? `${clipped(widest.el) ? '[clipped] ' : ''}${widest.el.tagName.toLowerCase()}${widest.el.id ? '#' + widest.el.id : ''}` +
          `${widest.el.getAttribute('class') ? '.' + widest.el.getAttribute('class')!.trim().split(/\s+/).join('.') : ''}` +
          ` @${Math.round(widest.r.width)}px right=${Math.round(widest.r.right)}`
        : '(none identified)',
    };
  });
  expect(overflow, `page must not scroll horizontally in state: ${label}`).toBeNull();
}

/**
 * Every scrolling container must be operable from the keyboard (WCAG 2.1.1).
 * If it holds no focusable content it needs `tabindex="0"`, so it becomes a
 * focus target arrow keys can then scroll.
 *
 * This lab currently avoids scrollers on purpose — long hex wraps via
 * `overflow-wrap: anywhere` — so the assertion is usually vacuous here. It
 * runs at every state anyway, because the requirement MATERIALISES the moment
 * someone reaches for `overflow-x: auto` on a wide value or table (the
 * stylesheet already carries an unused `.table-wrap` rule inviting exactly
 * that), and a scroller born without a keyboard route is invisible to axe.
 */
export async function expectScrollersReachable(page: Page, label: string): Promise<void> {
  const unreachable = await page.evaluate(() => {
    const FOCUSABLE = 'a[href],button,input,select,textarea,summary,[tabindex]:not([tabindex="-1"])';
    return Array.from(document.querySelectorAll<HTMLElement>('body *'))
      .filter((el) => el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1)
      .filter((el) => {
        const cs = getComputedStyle(el);
        return ['auto', 'scroll'].includes(cs.overflowX) || ['auto', 'scroll'].includes(cs.overflowY);
      })
      .filter((el) => el.tabIndex < 0 && !el.querySelector(FOCUSABLE))
      .map(
        (el) =>
          `${el.tagName.toLowerCase()}.${(el.getAttribute('class') ?? '').trim()}` +
          ` (${el.scrollWidth}x${el.scrollHeight} in ${el.clientWidth}x${el.clientHeight})`
      );
  });
  expect(
    Array.from(new Set(unreachable)),
    `scrolling regions with no keyboard route in state: ${label}`
  ).toEqual([]);
}

/**
 * Nothing may be focusable while it paints nothing (WCAG 2.4.3 / 2.4.7).
 *
 * `opacity: 0` with `pointer-events: none` is NOT hiding: the element keeps
 * `tabIndex: 0`, so a keyboard reader tabs to a control that is not on screen
 * and the focus ring lands nowhere. `display: none` and `visibility: hidden`
 * DO remove an element from the tab order, so those are skipped rather than
 * flagged — the failure is specifically the invisible-but-tabbable pair. The
 * `hidden` tabpanels here take the `display: none` route, which is why five
 * panels' worth of buttons are legitimately absent from the tab order.
 *
 * Off-screen-but-focusable is the WCAG-sanctioned skip-link idiom and is
 * deliberately not flagged: the shared skip link parks at `top:-3rem` with
 * full opacity and slides in on focus. The drive scans it focused.
 */
export async function expectNoInvisibleFocusTargets(page: Page, label: string): Promise<void> {
  const bad = await page.evaluate(() => {
    const FOCUSABLE = 'a[href],button,input,select,textarea,summary,[tabindex]:not([tabindex="-1"])';
    const out: string[] = [];
    for (const el of Array.from(document.querySelectorAll<HTMLElement>(FOCUSABLE))) {
      if (el.tabIndex < 0) continue;
      // display:none / visibility:hidden already remove it from the tab order.
      if (!el.checkVisibility?.({ checkVisibilityCSS: true })) continue;
      let effective = 1;
      for (let n: Element | null = el; n; n = n.parentElement) {
        effective *= parseFloat(getComputedStyle(n).opacity);
      }
      const r = el.getBoundingClientRect();
      if (effective !== 0 && r.width > 0 && r.height > 0) continue;
      // Confirm it really is reachable rather than inferring it.
      const before = document.activeElement;
      el.focus();
      const took = document.activeElement === el;
      (before as HTMLElement | null)?.focus?.();
      if (took) {
        out.push(
          `${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}.${(el.getAttribute('class') ?? '').trim()}` +
            ` (opacity ${effective}, ${Math.round(r.width)}x${Math.round(r.height)})`
        );
      }
    }
    return Array.from(new Set(out));
  });
  expect(bad, `focusable elements that paint nothing in state: ${label}`).toEqual([]);
}

/**
 * When `A11Y_COLLECT` is set, `scan` records failures instead of throwing.
 *
 * A strict gate reports the first failing assertion in the first failing state
 * and stops, so a page with defects in several states needs one full run per
 * defect to enumerate them. The collection pass turns that into a single run.
 * It is a debugging aid only: `A11Y_COLLECT` is never set in CI, and a run
 * with it set prints every finding as it happens and then fails at the end, so
 * a green collection run cannot be mistaken for a green gate.
 */
const COLLECTING = !!process.env.A11Y_COLLECT;
const collected: string[] = [];

function record(entry: string): void {
  collected.push(entry);
  // Printed as it happens, not only at the end: a hard assertion later in the
  // drive would otherwise abort the test before anything collected so far was
  // ever shown.
  console.log(`\n[A11Y_COLLECT #${collected.length}] ${entry}`);
}

export function softExpect(actual: unknown, message: string, expected: unknown): void {
  if (!COLLECTING) {
    expect(actual, message).toEqual(expected);
    return;
  }
  try {
    expect(actual, message).toEqual(expected);
  } catch {
    record(`${message}\n  ${JSON.stringify(actual, null, 2)}`);
  }
}

/**
 * Fail the test if the collection pass recorded anything. Without this a
 * collection run would end green, and a green collection run is
 * indistinguishable from a green gate — which is the exact confusion the whole
 * exercise exists to remove.
 */
export function reportCollected(): void {
  if (!COLLECTING) return;
  expect(collected, `A11Y_COLLECT recorded ${collected.length} failure(s)`).toEqual([]);
}

async function soft(fn: () => Promise<void>): Promise<void> {
  if (!COLLECTING) return fn();
  try {
    await fn();
  } catch (e) {
    // Generous, not 900: a truncated oracle dump is how a second and third
    // finding in the same state get missed on a collection pass.
    record(String(e).slice(0, 6000));
  }
}

/**
 * WCAG 1.4.11 and generated content, ratcheted against a per-repo baseline.
 *
 * Neither class has ANY other oracle: axe has no rule for non-text contrast,
 * and the arithmetic text walk cannot reach a control's boundary or a
 * `::before` glyph, because a pseudo-element is not an element and owns no
 * text node.
 *
 * IT IS CALLED FROM `scan()`, deliberately and not by accident. Fleet-wide
 * this oracle had been called from inside a soft wrapper AFTER its
 * `if (!COLLECTING) return` guard — so in a strict run, which is every run in
 * CI and every run anyone reads as a pass, the guard returned first and
 * `nontext.ts` never executed at all. Thirteen repos certified themselves
 * clean on an oracle that had never looked. Calling it here means it runs at
 * every driven state, including `:hover`, and this repo's baseline was
 * captured by that live path.
 *
 * A check that merely logs is not a gate, so it ratchets: anything NOT in the
 * baseline fails, anything in the baseline that got WORSE fails, and anything
 * in the baseline that has been FIXED fails until its entry is deleted. That
 * last rule is what stops the allowlist becoming a permanent exemption.
 */
const nonTextSeen = new Set<string>();

export async function expectNoNewNonTextFailures(page: Page, label: string): Promise<void> {
  const found = await auditNonText(page);
  // Capture mode: emit every finding and assert nothing, so a baseline can be
  // generated by the SAME path that checks it.
  if (process.env.NT_BASELINE_CAPTURE) {
    for (const f of found) {
      console.log(`NTCAP|${f.kind}|${f.selector}|${f.ratio}|${f.required}|${/POSITIONED/.test(f.detail)}`);
    }
    return;
  }
  const problems: string[] = [];
  for (const f of found) {
    const key = `${f.kind}|${f.selector}`;
    nonTextSeen.add(key);
    const base = NONTEXT_BASELINE[key];
    if (!base) {
      problems.push(`NEW ${f.ratio}:1 (needs ${f.required}:1) [${f.kind}] ${f.selector} — ${f.detail}`);
    } else if (f.ratio < base.ratio - 0.01) {
      problems.push(`WORSE ${f.selector}: ${f.ratio}:1, baseline recorded ${base.ratio}:1`);
    }
  }
  expect(problems, `new or worsened non-text contrast in state: ${label}`).toEqual([]);
}

/**
 * Fail if a baselined finding never appeared during the whole drive.
 *
 * It has either been fixed — in which case delete the entry, which is the
 * point — or the drive stopped reaching the state that shows it, which is a
 * coverage regression worth knowing about. Call once, after `driveAllStates`.
 */
export function expectBaselineNotStale(): void {
  const unseen = Object.keys(NONTEXT_BASELINE).filter((k) => !nonTextSeen.has(k));
  expect(
    unseen,
    'baselined non-text findings that no longer appear — delete them from nontext-baseline.ts (or restore the drive state that showed them)'
  ).toEqual([]);
}

/**
 * Scan the page as it currently stands.
 *
 * Nine assertions, because axe's `violations` array alone is not a complete
 * oracle:
 *
 *  - reduced-motion end state — see `expectNotBlank`.
 *  - `violations` — the usual WCAG A/AA rule failures, plus four landmark
 *    best-practice rules `withTags` does not run on its own.
 *  - `incomplete` — axe's "could not decide" bucket, which never reaches the
 *    violations array. The one rule id allowed to remain incomplete is
 *    `color-contrast`, and only because the next assertion computes those
 *    ratios arithmetically — which matters here because the surfaces carrying
 *    this lab's meaning are `color-mix()` fills axe cannot resolve: the
 *    `--accent-soft` wash on every live quartet corner, highlighted middle
 *    difference and active nibble chip, the hero aside's accent tint, and the
 *    `.btn-primary:hover` and pressed-`.seg-btn:hover` mixes, plus the shared
 *    bar's ink. Everything else in that bucket is a real result axe simply could
 *    not finish — including `aria-prohibited-attr`, which is where an
 *    `aria-label` on a role-less element hides. This page leans on getting that
 *    right: nine scroll regions carry `role="region"` with an `aria-label`, the
 *    switch-case toggle carries `role="group"`, and every chart is an
 *    `<svg role="img">` named by `aria-label`. Drop any of those roles and the
 *    label is silently discarded.
 *  - arithmetic contrast — composite-aware WCAG 1.4.3 over every text node.
 *  - the same walk over `aria-hidden` content with the exemption lifted —
 *    SC 1.4.3 is about what a reader SEES; see `contrast.ts` for what this
 *    lab hides and why it is measured anyway.
 *  - non-text contrast and generated content — SC 1.4.11, ratcheted; see
 *    `expectNoNewNonTextFailures`. This is the only oracle that judges a
 *    control's boundary against the surface OUTSIDE it.
 *  - keyboard reachability of scrolling regions — WCAG 2.1.1.
 *  - no focusable element that paints nothing — WCAG 2.4.3/2.4.7.
 *  - reflow — WCAG 1.4.10, which axe has no rule for at all.
 */
export async function scan(page: Page, label: string): Promise<void> {
  await settle(page);
  await expectNotBlank(page, label);
  // TWO axe runs, deliberately, and this is not a style choice.
  //
  // `AxeBuilder.withTags()` and `AxeBuilder.withRules()` both write the same
  // `options.runOnly` field, so the second call SILENTLY REPLACES the first —
  // the axe-core/playwright source says so in as many words on `withRules`
  // ("Cannot be used with AxeBuilder#withTags"). Chained as
  // `.withTags(TAGS).withRules([...4 landmark rules])`, axe runs those FOUR
  // best-practice rules and NOT ONE WCAG RULE, while a green result reads
  // exactly like a full A/AA pass. For scale, `withTags(TAGS)` selects 69 of
  // axe-core 4.12's 105 rule definitions; the chained form executes 4.
  //
  // The landmark four are still wanted because they are best-practice rather
  // than WCAG-tagged, so `withTags` alone does not reach them — and this page
  // has the shape they catch: a sticky `<header role="banner">` above a
  // `<div id="app">` holding an `<aside class="cl-hero-why">`, two `<nav>`s
  // (the shared actions and the tablist wrapper), one `<main>` and a footer.
  const wcag = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  const landmarks = await new AxeBuilder({ page })
    .withRules([
      'landmark-no-duplicate-banner',
      'landmark-unique',
      'landmark-one-main',
      'landmark-complementary-is-top-level',
    ])
    .analyze();
  const results = {
    violations: [...wcag.violations, ...landmarks.violations],
    incomplete: [...wcag.incomplete, ...landmarks.incomplete],
  };

  const violations = results.violations.map((v) => ({
    state: label,
    id: v.id,
    impact: v.impact,
    help: v.help,
    nodes: v.nodes.map((n) => n.target.join(' ')).slice(0, 8),
  }));
  softExpect(violations, `axe violations in state: ${label}`, []);

  // The `incomplete` bucket is asserted, not skimmed. `aria-prohibited-attr`
  // and `aria-required-children` appear ONLY here — never in `violations` — so
  // a gate that ignores this bucket cannot see either. Only `color-contrast`
  // is allowed to remain, and only because the arithmetic walk below judges
  // those ratios for real; no other rule is filtered out.
  const unexplainedIncomplete = results.incomplete
    .filter((v) => v.id !== 'color-contrast')
    .map((v) => ({
      state: label,
      id: v.id,
      nodes: v.nodes.map((n) => n.target.join(' ')).slice(0, 8),
    }));
  softExpect(unexplainedIncomplete, `axe incomplete results in state: ${label}`, []);

  const contrast = Array.from(new Set(formatContrastFailures(await auditContrast(page))));
  softExpect(contrast, `measured contrast failures in state: ${label}`, []);

  // The aria-hidden walk, exemption lifted — axe skips this text entirely and
  // the default walk honours the same boundary, so this second call is the
  // ONLY thing that ever measures it. See `contrast.ts` for the inventory.
  const hiddenContrast = Array.from(
    new Set(
      formatContrastFailures(
        await auditContrast(page, '[aria-hidden="true"], [aria-hidden="true"] *', true)
      )
    )
  );
  softExpect(hiddenContrast, `measured aria-hidden contrast failures in state: ${label}`, []);

  await soft(() => expectNoNewNonTextFailures(page, label));
  await soft(() => expectScrollersReachable(page, label));
  await soft(() => expectNoInvisibleFocusTargets(page, label));
  await soft(() => expectNoHorizontalOverflow(page, label));
}

// ── The drive ───────────────────────────────────────────────────────────────

/** Wait for a panel to finish a Worker round trip, proven by its verdict count. */
async function awaitVerdicts(page: Page, panel: string, count: number): Promise<void> {
  await expect(page.locator(`${panel} .verdict`)).toHaveCount(count);
}

/**
 * Drive the lab through the states that render content, scanning each.
 *
 * Five things shape this drive:
 *
 *  - THE ARRIVAL STATE IS SCANNED FIRST, exactly as a reader gets it: five
 *    panels measured, every disclosure shut, the quartet walk on its first step.
 *
 *  - NO FIXED TIMEOUTS, ANYWHERE. Every panel here is filled by a Worker
 *    message, so a `waitForTimeout` would be the scan race in its purest form:
 *    axe would measure a "Measuring..." placeholder and report a clean page.
 *    Every wait is on a real completion signal - a verdict appearing, a step
 *    count, an `aria-pressed` flip, an `aria-invalid` attribute.
 *
 *  - EVERY FAILURE AND REFUSAL STATE. A zero input difference, a non-hex byte, a
 *    malformed key, a differential that turns out to be POSSIBLE, a sieve that
 *    runs out of pairs, and a switch that never closes. None of those is
 *    reachable without typing something wrong or choosing something awkward on
 *    purpose, and every one of them paints a verdict the default state never
 *    shows.
 *
 *  - THE QUARTET WALK IS SCANNED AT EVERY STEP. Each step reveals a line through
 *    an animation that starts at `opacity: 0`, and the final step paints the
 *    lab's headline alarm verdict. Scanning only the end would miss seven
 *    renderings; scanning only the start would miss the one that matters.
 *
 *  - HOVER IS A STATE, AND IT PERSISTS AFTER A CLICK. `:hover` stays on the
 *    element under the pointer after `page.click()` resolves, so it is the state
 *    a reader occupies the instant after pressing a button - and
 *    `.btn-primary:hover`, the pressed `.seg-btn:hover` and `.cl-btn:hover` all
 *    repaint their fill AND their border. Scanned explicitly.
 */
export async function driveAllStates(page: Page, theme: string): Promise<void> {
  const scanAt = (s: string): Promise<void> => scan(page, `${theme} / ${s}`);

  await scanAt('arrival: five panels measured, seven disclosures shut, walk on step 1');

  // ── The shared skip link, focused ───────────────────────────────────────
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.());
  await page.keyboard.press('Tab');
  await expect(page.locator('a.cl-skip-link')).toBeFocused();
  await scanAt('the shared skip link focused, slid in from top:-3rem');

  // ── Act 5: the quartet walk, every step ─────────────────────────────────
  // The headline mechanism. Step 8 paints the alarm verdict that is this lab's
  // negative claim, on the `--accent-soft` corners the live steps light up.
  for (let step = 2; step <= 8; step++) {
    await page.locator('#walk-step').click();
    await expect(page.locator('#walk-progress')).toHaveText(`Step ${step} of 8.`);
    await scanAt(`Act 5 walk: step ${step} of 8${step === 8 ? ' -- the alarm verdict' : ''}`);
  }
  await expect(page.locator('#walk-step')).toBeDisabled();
  await scanAt('Act 5 walk: complete, the step button disabled');

  await page.locator('#walk-reset').click();
  await expect(page.locator('#walk-progress')).toHaveText('Step 1 of 8.');
  await scanAt('Act 5 walk: reset to step 1, the step button live again');

  // ── Act 5: the other three switch cases ─────────────────────────────────
  // Each reruns Act 4 as well, so both panels repaint. The incompatible case is
  // the important one: it is the only state where the walk reports that no
  // quartet exists and the switch panel raises E_SWITCH_INCOMPATIBLE, which are
  // two verdicts that never appear otherwise.
  for (const [caseId, label] of [
    ['amplified', 'all four S-boxes active, trail out by 1600x'],
    ['control', 'DDT equals BCT, only the double charge'],
    ['incompatible', 'the round trip never closes'],
  ] as [string, string][]) {
    await page.locator(`.seg-btn[data-case="${caseId}"]`).click();
    await expect(page.locator(`.seg-btn[data-case="${caseId}"]`)).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    await expect(page.locator('#switch-out .verdict')).not.toHaveCount(0);
    await awaitVerdicts(page, '#boom-out', 2);
    await scanAt(`Act 5 case: ${label}`);
    if (caseId === 'incompatible') {
      await expect(page.locator('#switch-out .switch-incompatible .verdict-label')).toContainText(
        'NEVER CLOSES'
      );
      await expect(page.locator('#walk-out .walk-verdict .verdict-label')).toContainText(
        'NO QUARTET FOLLOWS THIS TRAIL'
      );
      await scanAt('Act 5 case: incompatible -- both refusal verdicts on screen');
    }
  }
  // Hover persists on the control just clicked, and a pressed .seg-btn repaints
  // its accent fill and its border on hover.
  await page.locator('.seg-btn[data-case="ladder"]').click();
  await expect(page.locator('.seg-btn[data-case="ladder"]')).toHaveAttribute('aria-pressed', 'true');
  await awaitVerdicts(page, '#boom-out', 2);
  await scanAt('Act 5: back on the ladder case, the pressed toggle hovered');

  // ── Act 5: both 16x16 tables, opened through their summary ──────────────
  await page.locator('#act5 details > summary').first().click();
  await expect(page.locator('#act5 details[open]')).toHaveCount(1);
  await expect(page.locator('#act5 .table-wrap table')).not.toHaveCount(0);
  await scanAt('Act 5: the DDT and BCT tables open, marked cells outlined');

  // ── Act 2: break it yourself ────────────────────────────────────────────
  // A difference that IS possible. The verdict tone changes, and the impossible
  // list still renders - a state the default never shows.
  await page.locator('#imp-delta').fill('0x11');
  await page.locator('#imp-run').click();
  await expect(page.locator('#imp-out .verdict-info .verdict-label')).toContainText('POSSIBLE');
  await scanAt('Act 2: a differential that is possible, and happened');

  // A zero input difference: the refusal path, with the cause named.
  await page.locator('#imp-alpha').fill('00');
  await page.locator('#imp-run').click();
  await expect(page.locator('#imp-out .imp-failure .verdict-label')).toContainText('E_ALPHA_ZERO');
  await expect(page.locator('#imp-alpha')).toHaveAttribute('aria-invalid', 'true');
  await scanAt('Act 2: zero input difference refused, the input aria-invalid');

  // A non-hex byte: a different refusal, and the 2px --bad boundary the
  // non-text oracle has to judge.
  await page.locator('#imp-alpha').fill('zz');
  await page.locator('#imp-run').click();
  await expect(page.locator('#imp-out .imp-failure .verdict-label')).toContainText('E_RANGE');
  await scanAt('Act 2: unparseable input difference refused');

  // A zero output difference.
  await page.locator('#imp-alpha').fill('0x0a');
  await page.locator('#imp-delta').fill('00');
  await page.locator('#imp-run').click();
  await expect(page.locator('#imp-out .imp-failure .verdict-label')).toContainText('E_DELTA_ZERO');
  await scanAt('Act 2: zero output difference refused');

  // Back to the shipped pair, and the exhaustive run over all 65536 keys - the
  // state whose verdict wording differs from the sampled one.
  await page.locator('#imp-delta').fill('0x01');
  await page.locator('#imp-keys').selectOption('65536');
  await page.locator('#imp-run').click();
  await expect(page.locator('#imp-out .verdict-pass .verdict-label')).toContainText(
    'PROVEN BY EXHAUSTION'
  );
  await scanAt('Act 2: impossibility proven over all 65536 keys');

  await page.locator('#act2 details > summary').first().click();
  await expect(page.locator('#act2 details[open]')).toHaveCount(1);
  await scanAt('Act 2: the honest-scope disclosure open');

  // ── Act 3: the sieve, including the state where it runs out of data ─────
  // 0x01 alone rules out 18 of 255 differences at four rounds and a single input
  // difference offers only 128 pairs, so some keys leave more than one candidate
  // standing. The page reports an ambiguous survivor set rather than guessing,
  // and that verdict is a different tone with a different border.
  await page.locator('#sieve-alphas').selectOption('1');
  let ambiguous = false;
  for (let attempt = 0; attempt < 30 && !ambiguous; attempt++) {
    await page.locator('#sieve-random').click();
    await awaitVerdicts(page, '#sieve-out', 2);
    ambiguous = (await page.locator('#sieve-out .sieve-verdict.verdict-alarm').count()) > 0;
  }
  expect(ambiguous, 'the weakest sieve must reach its ambiguous state within 30 random keys').toBe(
    true
  );
  await expect(page.locator('#sieve-out .sieve-verdict .verdict-label')).toContainText(
    'E_SIEVE_AMBIGUOUS'
  );
  await scanAt('Act 3: the sieve ran out of pairs with several candidates standing');

  // A malformed master key: the refusal path.
  await page.locator('#sieve-key').fill('nope');
  await page.locator('#sieve-run').click();
  await expect(page.locator('#sieve-out .sieve-failure .verdict-label')).toContainText('E_RANGE');
  await expect(page.locator('#sieve-key')).toHaveAttribute('aria-invalid', 'true');
  await scanAt('Act 3: malformed master key refused, the input aria-invalid');

  // Back to two input differences, where the recovery is unique.
  await page.locator('#sieve-key').fill('0xabcd');
  await page.locator('#sieve-alphas').selectOption('4,10');
  await page.locator('#sieve-run').click();
  await expect(page.locator('#sieve-out .sieve-verdict.verdict-pass .verdict-label')).toContainText(
    'SUBKEY RECOVERED'
  );
  await scanAt('Act 3: subkey recovered uniquely, master key still secret');

  await page.locator('#act3 details > summary').first().click();
  await expect(page.locator('#act3 details[open]')).toHaveCount(1);
  await scanAt('Act 3: the cost disclosure open');

  // ── Act 1 and Act 4 at larger sample sizes ──────────────────────────────
  await page.locator('#decay-keys').selectOption('2048');
  await page.locator('#decay-run').click();
  await awaitVerdicts(page, '#decay-out', 2);
  await scanAt('Act 1: measured over 2048 keys, the primary button hovered');

  await page.locator('#boom-keys').selectOption('3000');
  await page.locator('#boom-run').click();
  await awaitVerdicts(page, '#boom-out', 2);
  await scanAt('Act 4: 3000 keys, the primary button hovered');

  await page.locator('#act4 details > summary').first().click();
  await expect(page.locator('#act4 details[open]')).toHaveCount(1);
  await scanAt('Act 4: the per-key spread disclosure open');

  // ── The remaining disclosures ───────────────────────────────────────────
  for (const sel of ['#act0 details > summary', '#act6 details > summary']) {
    await page.locator(sel).first().click();
  }
  await expect(page.locator('details[open]')).not.toHaveCount(0);
  await scanAt('the cipher tables and the reference list open');

  // ── A focus ring on a native control, and on a select ───────────────────
  await page.locator('#global-sbox').focus();
  await expect(page.locator('#global-sbox')).toBeFocused();
  await scanAt('the S-box select focused, its custom chevron behind the value');

  await page.locator('#imp-alpha').focus();
  await expect(page.locator('#imp-alpha')).toBeFocused();
  await scanAt('a text input focused');

  // ── The other S-box: every panel reruns ─────────────────────────────────
  // The PRESENT table changes every number on the page, and its switch cases
  // land on different table cells. Scanned with all the disclosures still open,
  // which is the widest rendering this page has.
  await page.locator('#global-sbox').selectOption('strong');
  await awaitVerdicts(page, '#decay-out', 2);
  await awaitVerdicts(page, '#boom-out', 2);
  await expect(page.locator('#switch-out .verdict')).not.toHaveCount(0);
  await scanAt('the PRESENT S-box, every panel rerun, disclosures open');

  await page.locator('#global-sbox').selectOption('weak');
  await awaitVerdicts(page, '#decay-out', 2);
  await scanAt('back on the textbook S-box');
}
