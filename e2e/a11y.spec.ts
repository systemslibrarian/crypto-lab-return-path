import { expect, test } from '@playwright/test';
import {
  boot,
  driveAllStates,
  expectBaselineNotStale,
  NARROW,
  reportCollected,
  watchPageErrors,
} from './gate';

/**
 * WCAG A/AA regression gate.
 *
 * The lab is driven along everything it teaches: the arrival state, where all
 * five measuring panels have completed a Worker round trip and every one of the
 * seven disclosures is shut; the shared skip link focused; all eight steps of
 * the quartet walk, whose last step paints this lab's headline alarm verdict on
 * the accent-washed corners the live steps light up; the walk complete and its
 * button disabled, then reset; all four switch cases, including the incompatible
 * one where the walk reports that no quartet exists and the switch panel raises
 * E_SWITCH_INCOMPATIBLE; both 16x16 tables open with their marked cells
 * outlined; Act 2 driven onto a differential that is POSSIBLE, then onto a zero
 * input difference, an unparseable byte and a zero output difference, each
 * refused behind an `aria-invalid` boundary with its cause named, then the
 * exhaustive run over all 65536 keys; Act 3 driven to its ambiguous survivor set
 * by trying random keys until the weakest sieve runs out of pairs, then onto a
 * malformed master key, then back to a unique recovery; Acts 1 and 4 at larger
 * sample sizes with the primary button left hovered; every remaining disclosure
 * open; a focus ring on a select and on a text input; and finally the whole page
 * rerun on the PRESENT S-box with every disclosure still open, which is the
 * widest rendering it has. Every one of those states is scanned, at desktop and
 * phone width.
 *
 * See `gate.ts` for why nothing is injected into the page (an injected
 * `animation: none` would kill the quartet walk's reveal without restoring the
 * opacity its reduced-motion block restores, and every revealed step would be
 * scanned invisible), why no panel is revealed from script, why the lab's
 * defaults are asserted rather than assumed - which on this page means waiting
 * for a Worker rather than a timeout - and why `violations` is not the whole
 * oracle.
 */

for (const theme of ['dark'] as const) {
  test(`no WCAG A/AA violations in ${theme} theme`, async ({ page }) => {
    test.setTimeout(1_800_000);
    const errors = watchPageErrors(page);
    await boot(page, theme);
    await driveAllStates(page, theme);
    expect(errors, errors.join('\n')).toEqual([]);
    expectBaselineNotStale();
    reportCollected();
  });

  test(`no WCAG A/AA violations in ${theme} theme at 380px`, async ({ page }) => {
    test.setTimeout(1_800_000);
    const errors = watchPageErrors(page);
    await page.setViewportSize(NARROW);
    await boot(page, theme);
    await driveAllStates(page, `${theme} @380px`);
    expect(errors, errors.join('\n')).toEqual([]);
    expectBaselineNotStale();
    reportCollected();
  });
}
