import { expect, test, type Page } from '@playwright/test';

/**
 * The entry experience, as a gate rather than an impression.
 *
 * Page weight is the kind of quality that rots silently: every individual
 * paragraph is worth adding, and the twentieth one is what pushes the headline
 * result off the screen. So the three things that make this page enterable are
 * measured and enforced:
 *
 *   - a meaningful interaction inside the first viewport on desktop, and inside
 *     the second on a phone;
 *   - the headline result -- the paradox itself -- fully visible within two phone
 *     screens, where it used to be fifteen;
 *   - a ceiling on arrival-state copy, ratcheted. It was 3 181 words before the
 *     reduction pass and is about 2 000 after; the ceiling sits just above that,
 *     so restoring a couple of paragraphs is fine and restoring twenty is not.
 *
 * The ceiling is a to-do list in the same sense as the non-text baseline: it may
 * be lowered, never raised, without a reason recorded here.
 */

const WORD_CEILING = 2200;

async function settle(page: Page): Promise<void> {
  for (const p of ['#decay-out', '#imp-out', '#sieve-out', '#boom-out', '#switch-out', '#walk-out']) {
    await expect(page.locator(p)).not.toHaveAttribute('data-run', '0');
  }
}

async function metrics(page: Page): Promise<{
  words: number;
  firstControlTop: number;
  teaserBottom: number;
  viewport: number;
  overWide: string[];
}> {
  return page.evaluate(() => {
    const visibleText = (root: Element): string => {
      let out = '';
      const walk = (el: Element): void => {
        if (!(el as HTMLElement).checkVisibility?.({ checkVisibilityCSS: true })) return;
        if (el.closest('details:not([open])') && !el.closest('summary')) return;
        for (const n of Array.from(el.childNodes)) {
          if (n.nodeType === Node.TEXT_NODE) out += ' ' + (n.textContent ?? '');
          else if (n.nodeType === Node.ELEMENT_NODE) walk(n as Element);
        }
      };
      walk(root);
      return out;
    };
    const app = document.getElementById('app')!;
    const control = document.querySelector('#app button, #app select, #app input') as HTMLElement | null;
    const teaserEl = document.getElementById('teaser');
    // Ordinary prose should stay in a comfortable measure. Measured as the
    // rendered width divided by the width of one character in the same font,
    // rather than by counting characters, because that is what a reader sees.
    const overWide: string[] = [];
    for (const p of Array.from(document.querySelectorAll('#app p'))) {
      const text = (p.textContent ?? '').trim();
      if (text.split(/\s+/).length < 25) continue;
      if (!(p as HTMLElement).checkVisibility?.({ checkVisibilityCSS: true })) continue;
      const cs = getComputedStyle(p);
      if (cs.fontFamily.includes('mono')) continue;
      const probe = document.createElement('span');
      probe.style.font = cs.font;
      probe.style.position = 'absolute';
      probe.style.visibility = 'hidden';
      probe.textContent = '0'.repeat(100);
      document.body.append(probe);
      const chWidth = probe.getBoundingClientRect().width / 100;
      probe.remove();
      const ch = p.getBoundingClientRect().width / chWidth;
      if (ch > 90) overWide.push(`${p.className || p.tagName} at ${Math.round(ch)}ch`);
    }
    return {
      words: visibleText(app).trim().split(/\s+/).filter((w) => /[A-Za-z]{2}/.test(w)).length,
      firstControlTop: control ? control.getBoundingClientRect().top + window.scrollY : -1,
      teaserBottom: teaserEl ? teaserEl.getBoundingClientRect().bottom + window.scrollY : -1,
      viewport: window.innerHeight,
      overWide,
    };
  });
}

test('desktop: a real interaction inside the first viewport', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('.');
  await settle(page);
  const m = await metrics(page);
  expect(m.firstControlTop, 'the first control must be above the fold').toBeGreaterThan(0);
  expect(m.firstControlTop).toBeLessThan(m.viewport);
  // And it is the teaser's own action, not a filter buried in a card.
  await expect(page.locator('#teaser-step')).toBeVisible();
});

test('phone: the headline result is fully visible within two screens', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('.');
  await settle(page);
  const m = await metrics(page);
  expect(m.teaserBottom, 'the paradox must be complete within two phone screens').toBeLessThan(
    2 * m.viewport
  );
  expect(m.firstControlTop, 'a control must be reachable by the second phone screen').toBeLessThan(
    2 * m.viewport
  );
});

test('the paradox is stated with both real numbers, not asserted in prose', async ({ page }) => {
  await page.goto('.');
  await settle(page);
  const cells = page.locator('#teaser .teaser-cell-val');
  await expect(cells).toHaveCount(2);
  // The one-way entries are zero and the round-trip entries are the full 16:
  // the two halves of the claim, both on screen, both from the page's own S-box.
  await expect(cells.nth(0)).toHaveText('0/16 and 0/16');
  await expect(cells.nth(1)).toHaveText('16/16 and 16/16');
  await expect(page.locator('#teaser .teaser-line')).toContainText('Impossible in one direction');
});

test('the teaser action lands the reader on the mechanism, stepped', async ({ page }) => {
  await page.goto('.');
  await settle(page);
  await page.locator('#teaser-step').click();
  // One action reaches Act 5 AND advances the walk, rather than scrolling to a heading.
  await expect(page.locator('#walk-progress')).toHaveText('Step 2 of 8.');
  await expect(page.locator('#walk-step')).toBeFocused();
  await expect(page.locator('#act5')).toBeInViewport();
});

test('every chapter link points at a section that exists', async ({ page }) => {
  await page.goto('.');
  await settle(page);
  const links = page.locator('.chapter-link');
  await expect(links).toHaveCount(5);
  for (const href of await links.evaluateAll((els) => els.map((e) => e.getAttribute('href') ?? ''))) {
    expect(href).toMatch(/^#/);
    await expect(page.locator(href)).toHaveCount(1);
  }
});

test('ARRIVAL COPY CEILING: the reduction pass does not rot', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('.');
  await settle(page);
  const m = await metrics(page);
  expect(
    m.words,
    `arrival-state copy is ${m.words} words, over the ${WORD_CEILING} ceiling. Move depth into an "Inspect the evidence" disclosure rather than raising this.`
  ).toBeLessThanOrEqual(WORD_CEILING);
});

test('ordinary prose stays in a readable measure at desktop width', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto('.');
  await settle(page);
  const m = await metrics(page);
  expect(m.overWide, 'paragraphs wider than 90ch').toEqual([]);
});
