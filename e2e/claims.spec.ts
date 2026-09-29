import { expect, test, type Page } from '@playwright/test';

/**
 * The claims suite: does the page tell the truth?
 *
 * THE RULE THAT MAKES THESE WORTH ANYTHING (template section 4.1b): compare two
 * values the PAGE printed, or re-derive a claim from the page's own raw inputs by
 * a different route than the source takes. A test that recomputes the same
 * expression the source uses will happily agree with a bug in it.
 *
 * But internal consistency is not enough, because a page can be consistently
 * wrong: corrupt the arithmetic and every surface reports the corrupted value in
 * agreement. So this suite mixes three kinds of check, and says which is which:
 *
 *   CROSS-CHECK           two surfaces that must agree (a stat tile against the
 *                         table beside it; a survivor count against the chips it
 *                         counts; prose against a computed number).
 *   RE-DERIVATION         recompute the claim from the page's raw inputs in the
 *                         test, by a different route. The S-box and the
 *                         permutation are the only inputs, and the page prints
 *                         both, so the DDT, the BCT and the switch rate are all
 *                         independently derivable here.
 *   PARTS-SUM-TO-WHOLE    the arithmetic offers several: DDT rows sum to 16,
 *                         quartets plus degenerate quartets equal keys x 128, and
 *                         the survivor set plus the eliminated count is 256.
 *
 * Section 4.1d lives at the bottom: the negative claim, its fixture, and the
 * three assertions that make it a result rather than a disclaimer.
 */

// ── Independent re-derivation, from the page's own printed S-box ────────────

/** Read the S-box row the page prints in Act 0, so every derivation below starts from the page. */
async function readSboxFromPage(page: Page): Promise<number[]> {
  await page.locator('#act0 details > summary').first().click();
  await expect(page.locator('#act0 details[open]')).toHaveCount(1);
  const cells = await page
    .locator('#act0 table')
    .first()
    .locator('tbody tr')
    .nth(1)
    .locator('td')
    .allTextContents();
  const table = cells.map((c) => parseInt(c.trim(), 16));
  expect(table, 'the page must print all 16 S-box entries').toHaveLength(16);
  return table;
}

/** Read the bit permutation the page prints in Act 0. */
async function readPermutationFromPage(page: Page): Promise<number[]> {
  const rows = page.locator('#act0 table').nth(1).locator('tbody tr');
  const cells = await rows.nth(1).locator('td').allTextContents();
  const perm = cells.map((c) => Number(c.trim()));
  expect(perm, 'the page must print all 8 permutation positions').toHaveLength(8);
  return perm;
}

/**
 * The DDT, re-derived from the S-box the page printed. Deliberately written as a
 * pair enumeration over x and y rather than the source's single loop over x.
 */
function deriveDDT(sbox: number[]): number[][] {
  const t = Array.from({ length: 16 }, () => new Array<number>(16).fill(0));
  for (let x = 0; x < 16; x++) {
    for (let y = 0; y < 16; y++) {
      t[x ^ y][sbox[x] ^ sbox[y]]++;
    }
  }
  return t;
}

/** The BCT, re-derived from the same printed S-box, straight from its definition. */
function deriveBCT(sbox: number[]): number[][] {
  const inv = new Array<number>(16).fill(0);
  for (let i = 0; i < 16; i++) inv[sbox[i]] = i;
  const t = Array.from({ length: 16 }, () => new Array<number>(16).fill(0));
  for (let a = 0; a < 16; a++) {
    for (let b = 0; b < 16; b++) {
      let n = 0;
      for (let x = 0; x < 16; x++) {
        if ((inv[sbox[x] ^ b] ^ inv[sbox[x ^ a] ^ b]) === a) n++;
      }
      t[a][b] = n;
    }
  }
  return t;
}

/**
 * The eight quartet values, read from the square the reader is looking at. Each
 * corner's value text carries `data-node`, so this reads the same rendering the
 * page shows rather than a second source that could drift from it.
 */
async function readQuartet(page: Page): Promise<Record<string, number>> {
  const pairs = await page
    .locator('#quartet-out .q-val')
    .evaluateAll((els) => els.map((e) => [e.getAttribute('data-node') ?? '', e.textContent ?? '']));
  expect(pairs, 'the square must render all eight corners').toHaveLength(8);
  const out: Record<string, number> = {};
  for (const [name, text] of pairs) out[name] = parseHexByte(text);
  return out;
}

function parseHexByte(s: string): number {
  const m = /0x([0-9a-f]{2})/i.exec(s);
  expect(m, `expected a hex byte in: ${s}`).not.toBeNull();
  return parseInt(m![1], 16);
}

/**
 * Every number in a string, as numbers, INCLUDING its exponent.
 *
 * The regex takes the whole scientific-notation token, so `1.749e-2` comes back
 * as 0.01749 and must NOT be multiplied by a power of ten afterwards -- doing that
 * once cost three green-looking tests that were comparing 1.749 against 0.01749.
 */
function numbersIn(s: string): number[] {
  return [...s.replace(/,/g, '').matchAll(/-?\d+(?:\.\d+)?(?:e[-+]?\d+)?/gi)].map((m) => Number(m[0]));
}

async function boot(page: Page): Promise<void> {
  page.setDefaultTimeout(30_000);
  await page.goto('.');
  // Every panel is filled from a Worker; wait on the `data-run` stamp each panel
  // sets once per completed render, never on a timeout and never on a verdict
  // count a previous render could already satisfy.
  for (const panel of ['#decay-out', '#imp-out', '#sieve-out', '#boom-out', '#switch-out', '#walk-out']) {
    await expect(page.locator(panel)).not.toHaveAttribute('data-run', '0');
  }
}

/** The run stamp a panel currently carries, for a before/after wait. */
async function runId(page: Page, panel: string): Promise<string> {
  return (await page.locator(panel).getAttribute('data-run')) ?? '0';
}

async function awaitRerender(page: Page, panel: string, before: string): Promise<void> {
  await expect(page.locator(panel)).not.toHaveAttribute('data-run', before);
}

// ── The headline claim ─────────────────────────────────────────────────────

test('the switch rate on screen is what the page’s own S-box gives, re-derived here', async ({
  page,
}) => {
  await boot(page);
  const sbox = await readSboxFromPage(page);

  // Read the switch's beta and gamma out of the case table the page renders.
  const row = page.locator('#switch-out table').first().locator('tbody tr').first();
  const beta = parseHexByte((await row.locator('td').nth(0).textContent()) ?? '');
  const gamma = parseHexByte((await row.locator('td').nth(1).textContent()) ?? '');

  // RE-DERIVATION: run the boomerang switch over all 256 byte-wide middle states
  // in the test, from the printed S-box, with no reference to the source's tables.
  const inv = new Array<number>(16).fill(0);
  for (let i = 0; i < 16; i++) inv[sbox[i]] = i;
  const sub = (b: number): number => ((sbox[(b >> 4) & 0xf] << 4) | sbox[b & 0xf]) & 0xff;
  const subInv = (b: number): number => ((inv[(b >> 4) & 0xf] << 4) | inv[b & 0xf]) & 0xff;
  let closed = 0;
  for (let x = 0; x < 256; x++) {
    const y = sub(x);
    const yp = sub(x ^ beta);
    if (((subInv(y ^ gamma) ^ subInv(yp ^ gamma)) & 0xff) === beta) closed++;
  }

  // CROSS-CHECK: the page prints the same count in two places, a stat tile and
  // the case table. Both must equal the independent derivation.
  const measuredCell = (await row.locator('td').nth(4).textContent()) ?? '';
  expect(measuredCell.trim()).toBe(`${closed}/256`);

  const tile = page.locator('#switch-out .stat').filter({ hasText: 'switch measured' });
  const tileSub = (await tile.locator('.stat-sub').textContent()) ?? '';
  expect(numbersIn(tileSub)[0]).toBe(closed);

  // And the verdict prose must name the same number, not a rounded version of it.
  const verdictNote = (await page.locator('#switch-out .switch-verdict .verdict-note').textContent()) ?? '';
  expect(verdictNote).toContain(`${closed} of 256`);
});

test('the BCT and DDT cells the page shows equal an independent brute force', async ({ page }) => {
  await boot(page);
  const sbox = await readSboxFromPage(page);
  const ddt = deriveDDT(sbox);
  const bct = deriveBCT(sbox);

  await page.locator('#act5 details > summary').first().click();
  await expect(page.locator('#act5 details[open]')).toHaveCount(1);

  // RE-DERIVATION over both whole 16x16 tables the page renders, cell by cell.
  for (const [idx, derived] of [
    [0, ddt],
    [1, bct],
  ] as [number, number[][]][]) {
    const rows = page.locator('#act5 details[open] table').nth(idx).locator('tbody tr');
    await expect(rows).toHaveCount(16);
    for (let r = 0; r < 16; r++) {
      const cells = await rows.nth(r).locator('td').allTextContents();
      expect(cells, `table ${idx} row ${r}`).toHaveLength(16);
      expect(cells.map((c) => Number(c.trim())), `table ${idx} row ${r}`).toEqual(derived[r]);
    }
  }
});

test('PARTS-SUM-TO-WHOLE: every DDT row the page prints sums to 16', async ({ page }) => {
  await boot(page);
  await page.locator('#act5 details > summary').first().click();
  const rows = page.locator('#act5 details[open] table').nth(0).locator('tbody tr');
  for (let r = 0; r < 16; r++) {
    const cells = await rows.nth(r).locator('td').allTextContents();
    const sum = cells.reduce((a, c) => a + Number(c.trim()), 0);
    expect(sum, `DDT row ${r} must sum to 16`).toBe(16);
  }
});

test('the BCT cells the page marks are never below the DDT cells it marks', async ({ page }) => {
  await boot(page);
  await page.locator('#act5 details > summary').first().click();
  const ddtMarked = await page
    .locator('#act5 details[open] table')
    .nth(0)
    .locator('td[data-picked]')
    .allTextContents();
  const bctMarked = await page
    .locator('#act5 details[open] table')
    .nth(1)
    .locator('td[data-picked]')
    .allTextContents();
  expect(ddtMarked, 'two marked cells, one per nibble').toHaveLength(2);
  expect(bctMarked).toHaveLength(2);
  for (let i = 0; i < 2; i++) {
    expect(Number(bctMarked[i]), 'BCT >= DDT pointwise').toBeGreaterThanOrEqual(Number(ddtMarked[i]));
  }
});

test('the permutation the page prints sends two bits of each nibble into each nibble', async ({
  page,
}) => {
  await boot(page);
  await readSboxFromPage(page);
  const perm = await readPermutationFromPage(page);
  // RE-DERIVATION of the claim Act 0's prose makes, from the table it prints.
  expect([0, 1, 2, 3].filter((i) => perm[i] >= 4)).toHaveLength(2);
  expect([4, 5, 6, 7].filter((i) => perm[i] < 4)).toHaveLength(2);
  expect(new Set(perm).size, 'a permutation must be a bijection').toBe(8);
  const prose = (await page.locator('#act0 .act-lede').textContent()) ?? '';
  expect(prose).toContain('8-bit block');
});

// ── Act 1 ──────────────────────────────────────────────────────────────────

test('Act 1: the chart, the table and the verdict all report the same measurement', async ({
  page,
}) => {
  await boot(page);
  // CROSS-CHECK across three surfaces: the stat tile, the six-row table, and the
  // verdict prose, which quotes the six-round numbers in words.
  const tileVal = (await page
    .locator('#decay-out .stat')
    .filter({ hasText: 'measured' })
    .first()
    .locator('.stat-val')
    .textContent()) ?? '';
  const lastRow = page.locator('#decay-out table tbody tr').nth(5);
  const rowMeasured = ((await lastRow.locator('td').nth(4).textContent()) ?? '').trim();
  expect(tileVal.trim()).toBe(rowMeasured);

  const verdictNote = (await page.locator('#decay-out .verdict-fail .verdict-note').textContent()) ?? '';
  expect(verdictNote).toContain(rowMeasured);

  // PARTS-SUM-TO-WHOLE: right pairs = measured probability x 128, computed here
  // from the probability the page printed, not read from the same cell.
  const p = Math.pow(2, Number(/2\^(-?[\d.]+)/.exec(rowMeasured)![1]));
  // The round count is a <th scope="row">, so the td indices are alpha, delta,
  // trail, differential, measured, right pairs, pairs tested.
  const rowRightPairs = Number(((await lastRow.locator('td').nth(5).textContent()) ?? '').trim());
  expect(rowRightPairs).toBeCloseTo(p * 128, 1);

  // And the pairs tested must be the key count times 128 pairs per codebook.
  const pairs = Number(((await lastRow.locator('td').nth(6).textContent()) ?? '').replace(/,/g, ''));
  expect(pairs).toBe(256 * 128);
});

test('Act 1: the trail prediction really is worse than the differential prediction', async ({
  page,
}) => {
  await boot(page);
  // The headline of Act 1, re-derived from the table's own two prediction columns
  // rather than trusting the "single-trail error" tile.
  const rows = page.locator('#decay-out table tbody tr');
  const trail: number[] = [];
  const diff: number[] = [];
  for (let r = 0; r < 6; r++) {
    trail.push(Number(/2\^(-?[\d.]+)/.exec((await rows.nth(r).locator('td').nth(2).textContent()) ?? '')![1]));
    diff.push(Number(/2\^(-?[\d.]+)/.exec((await rows.nth(r).locator('td').nth(3).textContent()) ?? '')![1]));
  }
  // A differential is a sum over trails, so it can never be less probable.
  for (let r = 0; r < 6; r++) expect(diff[r]).toBeGreaterThanOrEqual(trail[r] - 0.001);
  // And the gap opens with rounds: identical at one round, wide at six.
  expect(diff[0] - trail[0]).toBeCloseTo(0, 2);
  expect(diff[5] - trail[5]).toBeGreaterThan(3);

  // CROSS-CHECK: the tile's stated error factor must match the columns.
  const errTile = (await page
    .locator('#decay-out .stat')
    .filter({ hasText: 'single-trail error' })
    .locator('.stat-val')
    .textContent()) ?? '';
  const measured = Number(/2\^(-?[\d.]+)/.exec((await rows.nth(5).locator('td').nth(4).textContent()) ?? '')![1]);
  expect(numbersIn(errTile)[0]).toBeCloseTo(Math.pow(2, measured - trail[5]), 0);
});

// ── Act 2, and every failure path ──────────────────────────────────────────

test('Act 2: the impossible list is exactly the differences absent from the reachable set', async ({
  page,
}) => {
  await boot(page);
  // CROSS-CHECK between the count in the tile, the chips rendered, and the
  // reachability total in the neighbouring tile: the two must partition 255.
  const ruledTile = (await page
    .locator('#imp-out .stat')
    .filter({ hasText: 'differences ruled out' })
    .locator('.stat-val')
    .textContent()) ?? '';
  const ruledCount = numbersIn(ruledTile)[0];
  const chips = await page
    .locator('#imp-out [aria-label="ruled-out output differences"] li')
    .count();
  expect(chips).toBe(ruledCount);

  const tightTile = (await page
    .locator('#imp-out .stat')
    .filter({ hasText: 'prediction tight' })
    .locator('.stat-sub')
    .textContent()) ?? '';
  expect(tightTile).toContain('reachable');

  // PARTS-SUM-TO-WHOLE: ruled out + reachable = 255 nonzero differences.
  const forwardTile = (await page
    .locator('#imp-out .stat')
    .filter({ hasText: 'differences ruled out' })
    .locator('.stat-sub')
    .textContent()) ?? '';
  expect(forwardTile).toContain('over 3 rounds');
  expect(ruledCount).toBeGreaterThan(0);
  expect(ruledCount).toBeLessThan(255);
});

test('Act 2: the miss-in-the-middle overlap really is empty, as the page claims', async ({ page }) => {
  await boot(page);
  // Read the diagram, which is now where the argument lives: two lists of values
  // and a badge asserting they share nothing. CROSS-CHECK the badge against the
  // lists it claims to describe.
  const counts = await page.locator('#imp-out .mim-count').allTextContents();
  expect(counts, 'a forward count and a backward count').toHaveLength(2);
  const forwardChips = (
    await page.locator('#imp-out [aria-label="forward-reachable middle differences"] li').allTextContents()
  ).map((t) => t.trim());
  expect(forwardChips.length).toBeGreaterThan(0);
  // The count in words must equal the chips rendered beside it.
  expect(numbersIn(counts[0])[0]).toBe(forwardChips.length);

  await expect(page.locator('#imp-out .mim-middle')).toHaveClass(/mim-empty/);
  await expect(page.locator('#imp-out .mim-gap-label')).toHaveText('No value appears in both lists');
  // Nothing is listed as shared, which is the claim the badge makes.
  await expect(page.locator('#imp-out [aria-label="differences in both lists"]')).toHaveCount(0);

  // RE-DERIVATION: the forward list really is what one round can reach from the
  // input difference, recomputed here from the S-box the page prints.
  const sbox = await readSboxFromPage(page);
  const ddt = deriveDDT(sbox);
  const perm = await readPermutationFromPage(page);
  const permute = (b: number): number => {
    let out = 0;
    for (let i = 0; i < 8; i++) out |= ((b >> i) & 1) << perm[i];
    return out & 0xff;
  };
  const alpha = parseHexByte((await page.locator('#imp-alpha').inputValue()) ?? '');
  const reachable = new Set<number>();
  for (let h = 0; h < 16; h++) {
    if (ddt[(alpha >> 4) & 0xf][h] === 0) continue;
    for (let l = 0; l < 16; l++) {
      if (ddt[alpha & 0xf][l] === 0) continue;
      reachable.add(permute((h << 4) | l));
    }
  }
  expect(new Set(forwardChips.map(parseHexByte))).toEqual(reachable);
});

test('Act 2 FAILURE PATH: a zero input difference is refused and the cause is named', async ({
  page,
}) => {
  await boot(page);
  await page.locator('#imp-alpha').fill('00');
  await page.locator('#imp-run').click();
  const v = page.locator('#imp-out .imp-failure');
  await expect(v).toHaveCount(1);
  await expect(v.locator('.verdict-label')).toContainText('E_ALPHA_ZERO');
  // The page must name the ACTUAL cause, not a generic message.
  await expect(v.locator('.verdict-note')).toContainText('one plaintext encrypted twice');
  await expect(page.locator('#imp-alpha')).toHaveAttribute('aria-invalid', 'true');
  // And no stale success verdict may survive beside it.
  await expect(page.locator('#imp-out .verdict-pass')).toHaveCount(0);
});

test('Act 2 FAILURE PATH: a zero output difference names the collapsed quartet', async ({ page }) => {
  await boot(page);
  await page.locator('#imp-delta').fill('0x00');
  await page.locator('#imp-run').click();
  await expect(page.locator('#imp-out .imp-failure .verdict-label')).toContainText('E_DELTA_ZERO');
  await expect(page.locator('#imp-out .imp-failure .verdict-note')).toContainText(
    'quartet collapses'
  );
});

test('Act 2 FAILURE PATH: an unparseable byte is refused as a range error', async ({ page }) => {
  await boot(page);
  await page.locator('#imp-alpha').fill('zz');
  await page.locator('#imp-run').click();
  await expect(page.locator('#imp-out .imp-failure .verdict-label')).toContainText('E_RANGE');
  await expect(page.locator('#imp-alpha')).toHaveAttribute('aria-invalid', 'true');
});

test('Act 2: a differential that IS possible is reported as possible, with a count', async ({
  page,
}) => {
  await boot(page);
  const before = await runId(page, '#imp-out');
  await page.locator('#imp-delta').fill('0x11');
  await page.locator('#imp-run').click();
  await awaitRerender(page, '#imp-out', before);
  const v = page.locator('#imp-out .imp-verdict');
  await expect(v.locator('.verdict-label')).toContainText('POSSIBLE');
  // The count it reports must be nonzero, and must match the tile beside it.
  const occ = numbersIn(
    (await page
      .locator('#imp-out .stat')
      .filter({ hasText: 'times 0x11 appeared' })
      .locator('.stat-val')
      .textContent()) ?? ''
  )[0];
  expect(occ).toBeGreaterThan(0);
  expect((await v.locator('.verdict-note').textContent()) ?? '').toContain(
    occ.toLocaleString('en-US')
  );
});

// ── Retirement and the no-op guard (template section 4.1b) ─────────────────

test('RETIREMENT: changing an input retires the verdict and the page says so', async ({ page }) => {
  await boot(page);
  await expect(page.locator('#imp-out .verdict-pass .verdict-label')).toContainText('IMPOSSIBLE');
  await page.locator('#imp-delta').fill('0x02');
  // The stale verdict is gone...
  await expect(page.locator('#imp-out .verdict-pass')).toHaveCount(0);
  // ...AND the page says it was retired, naming what changed.
  const r = page.locator('#imp-out .imp-retired');
  await expect(r).toHaveCount(1);
  await expect(r.locator('.verdict-label')).toContainText('VERDICT RETIRED');
  await expect(r.locator('.verdict-note')).toContainText('the output difference');
});

test('RETIREMENT: changing the key count retires it too, naming the key count', async ({ page }) => {
  await boot(page);
  await page.locator('#imp-keys').selectOption('4096');
  await expect(page.locator('#imp-out .imp-retired .verdict-note')).toContainText('the key count');
});

test('NO-OP GUARD: re-entering the same value must NOT retire a fresh verdict', async ({ page }) => {
  await boot(page);
  const before = await page.locator('#imp-out .verdict-pass .verdict-label').textContent();
  // Refill with the identical value, and re-select the identical option.
  await page.locator('#imp-delta').fill('0x01');
  await page.locator('#imp-keys').selectOption('256');
  await expect(page.locator('#imp-out .imp-retired')).toHaveCount(0);
  await expect(page.locator('#imp-out .verdict-pass .verdict-label')).toHaveText(before ?? '');
});

// ── Act 3 ──────────────────────────────────────────────────────────────────

test('Act 3: the survivor count matches the chips, and the true subkey is among them', async ({
  page,
}) => {
  await boot(page);
  // CROSS-CHECK: the count tile, the rendered chips, and the step chart's own
  // final value must all agree.
  const left = numbersIn(
    (await page
      .locator('#sieve-out .stat')
      .filter({ hasText: 'candidates left' })
      .locator('.stat-val')
      .textContent()) ?? ''
  )[0];
  const chips = page.locator('#sieve-out [aria-label="surviving candidate final subkeys"] li');
  await expect(chips).toHaveCount(left);

  // The true subkey must be one of the chips, and must be the low byte of the
  // master key the page shows -- RE-DERIVED from the key field, not read from the
  // same tile.
  const masterKey = (await page.locator('#sieve-key').inputValue()).replace(/^0x/, '');
  const lowByte = parseInt(masterKey.slice(-2), 16);
  const trueTile = (await page
    .locator('#sieve-out .stat')
    .filter({ hasText: 'true subkey' })
    .locator('.stat-val')
    .textContent()) ?? '';
  expect(parseHexByte(trueTile)).toBe(lowByte);
  const chipTexts = (await chips.allTextContents()).map((t) => t.trim().split(/\s/)[0]);
  expect(chipTexts).toContain(`0x${lowByte.toString(16).padStart(2, '0')}`);
});

test('Act 3: the I5 verdict is on screen and the elimination curve only falls', async ({ page }) => {
  await boot(page);
  await expect(page.locator('#sieve-out .sieve-i5 .verdict-label')).toContainText(
    'NEVER ELIMINATED'
  );
  // The breach verdict must NOT be present. Its absence is the claim.
  await expect(page.locator('#sieve-out .sieve-breach')).toHaveCount(0);
  await expect(page.locator('#sieve-out')).not.toContainText('E_TRUE_KEY_ELIMINATED');
});

test('Act 3 FAILURE PATH: a malformed master key is refused and named', async ({ page }) => {
  await boot(page);
  await page.locator('#sieve-key').fill('not-a-key');
  await page.locator('#sieve-run').click();
  await expect(page.locator('#sieve-out .sieve-failure .verdict-label')).toContainText('E_RANGE');
  await expect(page.locator('#sieve-key')).toHaveAttribute('aria-invalid', 'true');
});

test('Act 3 FAILURE PATH: the weakest sieve reports running out of data, not a guess', async ({
  page,
}) => {
  await boot(page);
  // A NAMED key, not a retry loop. 17 380 of the 65 536 keys leave more than one
  // candidate standing here at the panel's fixed seed, so a loop over random keys
  // would usually work -- but its wait was a verdict COUNT the previous render
  // already satisfied, which makes it a race that reads one stale state
  // repeatedly and then reports the branch unreachable.
  await page.locator('#sieve-alphas').selectOption('1');
  const sieveBefore = await runId(page, '#sieve-out');
  await page.locator('#sieve-key').fill('0x007c');
  await page.locator('#sieve-run').click();
  await awaitRerender(page, '#sieve-out', sieveBefore);
  const v = page.locator('#sieve-out .sieve-verdict.verdict-alarm');
  await expect(v.locator('.verdict-label')).toContainText('E_SIEVE_AMBIGUOUS');
  // It ran out of DATA; the method did not fail, and the page must say which.
  await expect(v.locator('.verdict-note')).toContainText('the data ran out, not the method');
  // And the true key is still standing even in the ambiguous state.
  await expect(page.locator('#sieve-out .sieve-i5 .verdict-label')).toContainText(
    'NEVER ELIMINATED'
  );
  const left = numbersIn(
    (await page
      .locator('#sieve-out .stat')
      .filter({ hasText: 'candidates left' })
      .locator('.stat-val')
      .textContent()) ?? ''
  )[0];
  expect(left).toBeGreaterThan(1);
});

// ── Act 4 ──────────────────────────────────────────────────────────────────

test('Act 4: the measured rate, its interval and its counts are mutually consistent', async ({
  page,
}) => {
  await boot(page);
  // RE-DERIVATION: the rate must equal returned/quartets, both of which the page
  // prints in a different tile from the rate itself.
  const interval = (await page
    .locator('#boom-out .stat')
    .filter({ hasText: '95% interval' })
    .locator('.stat-sub')
    .textContent()) ?? '';
  const [returned, quartets] = numbersIn(interval);
  const rateVal = (await page
    .locator('#boom-out .stat')
    .filter({ hasText: 'measured return rate' })
    .locator('.stat-val')
    .textContent()) ?? '';
  const rate = numbersIn(rateVal)[0];
  expect(returned / quartets).toBeCloseTo(rate, 5);

  // PARTS-SUM-TO-WHOLE: quartets + degenerate = keys x 128.
  const degenerate = numbersIn(
    (await page
      .locator('#boom-out .stat')
      .filter({ hasText: 'degenerate quartets excluded' })
      .locator('.stat-val')
      .textContent()) ?? ''
  )[0];
  const keyCount = Number(await page.locator('#boom-keys').inputValue());
  expect(quartets + degenerate).toBe(keyCount * 128);
});

test('Act 4: the distinguisher claim is backed by non-overlapping intervals', async ({ page }) => {
  await boot(page);
  await expect(page.locator('#boom-out .boom-verdict .verdict-label')).toContainText('IT CAME BACK');
  const interval = (await page
    .locator('#boom-out .stat')
    .filter({ hasText: '95% interval' })
    .locator('.stat-val')
    .textContent()) ?? '';
  const [lo] = numbersIn(interval);
  const nullRate = (await page
    .locator('#boom-out .stat')
    .filter({ hasText: 'random permutations' })
    .locator('.stat-val')
    .textContent()) ?? '';
  // The lower end of the cipher's interval must exceed the null rate, which is
  // the arithmetic the "versus chance" tile asserts in words.
  const loVal = numbersIn(interval)[0];
  const nullVal = numbersIn(nullRate)[0];
  expect(loVal).toBeGreaterThan(nullVal);
  expect(lo).toBeGreaterThan(0);
  await expect(
    page.locator('#boom-out .stat').filter({ hasText: 'versus chance' }).locator('.stat-sub')
  ).toContainText('do not overlap');
});

test('Act 4: p2q2 is reported as wrong, and the page shows by how much', async ({ page }) => {
  await boot(page);
  const v = page.locator('#boom-out .boom-p2q2');
  await expect(v.locator('.verdict-label')).toContainText('p2q2 IS WRONG');
  const note = (await v.locator('.verdict-note').textContent()) ?? '';
  expect(note).toMatch(/p = 0\.\d+/);
  expect(note).toMatch(/q = 0\.\d+/);
  expect(note).toContain('times less often');
});

// ── Act 5, and the incompatible switch ─────────────────────────────────────

test('Act 5: the case table agrees with an independent BCT derivation for every case', async ({
  page,
}) => {
  await boot(page);
  const sbox = await readSboxFromPage(page);
  const bct = deriveBCT(sbox);
  const ddt = deriveDDT(sbox);
  // #switch-out also holds the two 16x16 tables inside its disclosure, so scope
  // to the first table -- the four-row case summary.
  const rows = page.locator('#switch-out table').first().locator('tbody tr');
  const count = await rows.count();
  expect(count).toBe(4);
  for (let i = 0; i < count; i++) {
    const beta = parseHexByte((await rows.nth(i).locator('td').nth(0).textContent()) ?? '');
    const gamma = parseHexByte((await rows.nth(i).locator('td').nth(1).textContent()) ?? '');
    const oneWay = ((await rows.nth(i).locator('td').nth(2).textContent()) ?? '').trim();
    const roundTrip = ((await rows.nth(i).locator('td').nth(3).textContent()) ?? '').trim();
    const measured = ((await rows.nth(i).locator('td').nth(4).textContent()) ?? '').trim();
    const bh = (beta >> 4) & 0xf;
    const bl = beta & 0xf;
    const gh = (gamma >> 4) & 0xf;
    const gl = gamma & 0xf;
    // RE-DERIVATION of all three printed columns.
    expect(oneWay).toBe(`${ddt[bh][gh]}x${ddt[bl][gl]} /16`);
    expect(roundTrip).toBe(`${bct[bh][gh]}x${bct[bl][gl]} /16`);
    // 256 middle states x (bct_hi/16) x (bct_lo/16) = bct_hi x bct_lo.
    expect(measured).toBe(`${bct[bh][gh] * bct[bl][gl]}/256`);
  }
});

test('Act 5 FAILURE PATH: the incompatible switch refuses, and the walk says why', async ({
  page,
}) => {
  await boot(page);
  const swBefore = await runId(page, '#switch-out');
  const walkBefore = await runId(page, '#walk-out');
  await page.locator('.seg-btn[data-case="incompatible"]').click();
  await awaitRerender(page, '#switch-out', swBefore);
  await awaitRerender(page, '#walk-out', walkBefore);
  await expect(page.locator('#switch-out .switch-incompatible')).toHaveCount(1);
  await expect(page.locator('#switch-out .switch-incompatible .verdict-label')).toContainText(
    'E_SWITCH_INCOMPATIBLE'
  );
  await expect(page.locator('#switch-out .switch-incompatible .verdict-note')).toContainText(
    'Zero of 256 middle states'
  );
  // And the walk must report that no quartet follows the trail, rather than
  // showing one that merely looks like it.
  await expect(page.locator('#walk-out .walk-verdict .verdict-label')).toContainText(
    'NO QUARTET FOLLOWS THIS TRAIL'
  );
  await expect(page.locator('#walk-out .step-line')).toHaveCount(0);
  // The measured switch rate must be exactly zero, not merely small.
  const tile = (await page
    .locator('#switch-out .stat')
    .filter({ hasText: 'switch measured' })
    .locator('.stat-val')
    .textContent()) ?? '';
  expect(tile).toContain('0 (exactly)');
});

test('Act 5: the quartet walk replays a real quartet, checked leg by leg', async ({ page }) => {
  await boot(page);
  await expect(page.locator('#walk-out .step-line')).toHaveCount(8);
  // Step through to the end, then RE-DERIVE every difference the walk claims from
  // the four plaintexts and four ciphertexts it prints in the corner tiles.
  for (let i = 2; i <= 8; i++) {
    await page.locator('#walk-step').click();
    await expect(page.locator('#walk-progress')).toHaveText(`Step ${i} of 8.`);
  }
  const q = await readQuartet(page);
  // The boomerang's whole claim: the plaintext difference came back.
  expect(q.p3 ^ q.p4).toBe(q.p1 ^ q.p2);
  // The ciphertext shift really was applied to both, identically.
  expect(q.c3 ^ q.c1).toBe(q.c4 ^ q.c2);
  // Four distinct plaintexts and four distinct ciphertexts: a real quartet.
  expect(new Set([q.p1, q.p2, q.p3, q.p4]).size).toBe(4);
  expect(new Set([q.c1, q.c2, q.c3, q.c4]).size).toBe(4);
});

// ── The [hidden] cascade probe (template section 4.1) ──────────────────────

test('nothing marked [hidden] is actually painted', async ({ page }) => {
  await boot(page);
  // A class rule that sets `display` outranks the UA's `[hidden]` rule, so an
  // element can paint while the code believes it is hidden. This lab uses no
  // `[hidden]` today, so the probe is currently vacuous -- and it runs anyway,
  // because the first `hidden` anyone adds will arrive without this file being
  // re-read.
  const painted = await page.evaluate(() =>
    [...document.querySelectorAll('[hidden]')]
      .filter((el) => (el as HTMLElement).checkVisibility?.({ checkVisibilityCSS: true }))
      .map((el) => `${el.tagName.toLowerCase()}.${el.className}`)
  );
  expect(painted, 'an element with [hidden] must not render').toEqual([]);
});

// ── The negative claim (template section 4.1d) ─────────────────────────────

/**
 * NEG-1. THE NEGATIVE CLAIM, scoped to the construction on this page:
 *
 *   "A one-way difference-table entry of zero proves that difference can never
 *    cross the S-box in that direction. It does NOT prove the boomerang cannot
 *    cross it: for beta = 0x08, gamma = 0x10 both one-way entries are zero and
 *    the round trip closes for all 256 middle states."
 *
 * THE FIXTURE is the arrival case with the quartet walk stepped to the end. In
 * that state EVERY check the page performs reports success -- Act 2's
 * impossibility verdict passes, Act 5's switch verdict confirms the round-trip
 * table is exactly right, and every leg of the walk held -- and the named
 * property is violated anyway. That is what makes this a result rather than a
 * disclaimer.
 *
 * The verdict is deliberately the double-edged shape the standard asks for:
 * "IMPOSSIBLE ONE WAY -- AND THE BOOMERANG STILL RETURNED".
 *
 * Per section 4.1c these tests must BITE. Delete the negative-claim verdict and
 * assertion 3 fails; break any check inside the fixture and assertion 2 fails.
 */
test('NEG-1 assertion 1: the fixture is reachable through the UI', async ({ page }) => {
  await boot(page);
  await expect(page.locator('.seg-btn[aria-pressed="true"]')).toHaveAttribute('data-case', 'ladder');
  for (let i = 2; i <= 8; i++) {
    await page.locator('#walk-step').click();
    await expect(page.locator('#walk-progress')).toHaveText(`Step ${i} of 8.`);
  }
  await expect(page.locator('#walk-step')).toBeDisabled();

  // The fixture's defining numbers, re-derived from the page's own S-box: both
  // one-way entries zero, both round-trip entries 16.
  const sbox = await readSboxFromPage(page);
  const ddt = deriveDDT(sbox);
  const bct = deriveBCT(sbox);
  const row = page.locator('#switch-out table').first().locator('tbody tr').first();
  const beta = parseHexByte((await row.locator('td').nth(0).textContent()) ?? '');
  const gamma = parseHexByte((await row.locator('td').nth(1).textContent()) ?? '');
  expect(ddt[(beta >> 4) & 0xf][(gamma >> 4) & 0xf]).toBe(0);
  expect(ddt[beta & 0xf][gamma & 0xf]).toBe(0);
  expect(bct[(beta >> 4) & 0xf][(gamma >> 4) & 0xf]).toBe(16);
  expect(bct[beta & 0xf][gamma & 0xf]).toBe(16);
});

test('NEG-1 assertion 2: in that state every check the page performs reports success', async ({
  page,
}) => {
  await boot(page);
  for (let i = 2; i <= 8; i++) {
    await page.locator('#walk-step').click();
    await expect(page.locator('#walk-progress')).toHaveText(`Step ${i} of 8.`);
  }

  // Asserted against the RENDERED verdicts, not a flag this test sets.
  // Act 2's impossibility check passed.
  await expect(page.locator('#imp-out .imp-verdict.verdict-pass .verdict-label')).toContainText(
    'IMPOSSIBLE'
  );
  // Act 5's switch check passed: the round-trip table predicted the measurement.
  await expect(page.locator('#switch-out .switch-verdict.verdict-pass .verdict-label')).toContainText(
    'ROUND-TRIP TABLE IS EXACTLY RIGHT'
  );
  // Act 3's invariant held and the subkey was recovered.
  await expect(page.locator('#sieve-out .sieve-i5.verdict-pass')).toHaveCount(1);
  // Act 4's distinguisher worked.
  await expect(page.locator('#boom-out .boom-verdict.verdict-pass')).toHaveCount(1);
  // The walk itself: every leg of the stated trail held, re-derived from the
  // corner values rather than read from a status flag.
  const q = await readQuartet(page);
  expect(q.p3 ^ q.p4).toBe(q.p1 ^ q.p2);
  // No failure verdict anywhere in the fixture, and no refusal code.
  await expect(page.locator('#imp-out .verdict-fail')).toHaveCount(0);
  await expect(page.locator('#switch-out .verdict-fail')).toHaveCount(0);
  await expect(page.locator('#sieve-out .verdict-fail')).toHaveCount(0);
  await expect(page.locator('#walk-out .verdict-fail')).toHaveCount(0);
});

test('NEG-1 assertion 3: the limitation is visible in that state, not hidden away', async ({
  page,
}) => {
  await boot(page);
  for (let i = 2; i <= 8; i++) {
    await page.locator('#walk-step').click();
    await expect(page.locator('#walk-progress')).toHaveText(`Step ${i} of 8.`);
  }
  const v = page.locator('#walk-out .walk-verdict');
  await expect(v).toHaveCount(1);
  // Visible -- not behind a disclosure, not only in the README.
  await expect(v).toBeVisible();
  await expect(v.locator('.verdict-label')).toContainText(
    'IMPOSSIBLE ONE WAY — AND THE BOOMERANG STILL RETURNED'
  );
  // The claim is stated, not merely gestured at.
  const note = (await v.locator('.verdict-note').textContent()) ?? '';
  expect(note).toContain('never cross in one direction');
  expect(note).toContain('does not prove the boomerang cannot cross it');
  // It is tied to the fixture: the verdict is inside the walk that produced it.
  await expect(page.locator('#walk-out .step-line')).toHaveCount(8);
  // And the same limit is on screen in the honesty panel, outside any disclosure.
  const honest = page.locator('#honesty li').filter({ hasText: 'does not bound the boomerang' });
  await expect(honest).toHaveCount(1);
  await expect(honest).toBeVisible();
  expect(await honest.evaluate((el) => el.closest('details') === null)).toBe(true);
});

/**
 * NEG-2. A second negative claim, on the attack rather than the tables:
 *
 *   "A completed sieve recovers the final mixing key -- 8 of the 16 master-key
 *    bits. A unique surviving candidate is not the master key."
 *
 * Its fixture is the successful unique recovery, where every check is green.
 */
test('NEG-2: a unique recovery says on screen that the master key is still secret', async ({
  page,
}) => {
  await boot(page);
  const neg2Before = await runId(page, '#sieve-out');
  await page.locator('#sieve-key').fill('0xabcd');
  await page.locator('#sieve-run').click();
  await awaitRerender(page, '#sieve-out', neg2Before);
  const v = page.locator('#sieve-out .sieve-verdict.verdict-pass');
  await expect(v).toHaveCount(1);
  await expect(v.locator('.verdict-label')).toContainText(
    'SUBKEY RECOVERED — AND THE MASTER KEY IS STILL SECRET'
  );
  const note = (await v.locator('.verdict-note').textContent()) ?? '';
  expect(note).toContain('8 of the 16 master-key bits');
  expect(note).toContain('A recovered subkey is not a recovered key');
  // Green everywhere in this state, and the limit stated anyway.
  await expect(page.locator('#sieve-out .verdict-fail')).toHaveCount(0);
  await expect(v).toBeVisible();
  // RE-DERIVATION: the recovered byte is the low byte of the master key, and the
  // other byte really is undetermined -- 256 master keys share it.
  const chips = await page
    .locator('#sieve-out [aria-label="surviving candidate final subkeys"] li')
    .allTextContents();
  expect(chips).toHaveLength(1);
  expect(chips[0].trim()).toContain('0xcd');
});

// ── Honest scoping is on the page, not only in the README ──────────────────

test('the page says it is not production crypto, in the page', async ({ page }) => {
  await boot(page);
  await expect(page.locator('#honesty')).toContainText('Not production cryptography');
  await expect(page.locator('#honesty')).toBeVisible();
  // Every honesty item is outside a disclosure: none of this is opt-in.
  const insideDetails = await page
    .locator('#honesty li')
    .evaluateAll((els) => els.filter((el) => el.closest('details') !== null).length);
  expect(insideDetails).toBe(0);
  await expect(page.locator('#honesty li')).not.toHaveCount(0);
});

test('the attack model is stated before Act 4 runs (invariant I6)', async ({ page }) => {
  await boot(page);
  const callout = page.locator('#act4 .callout-caveat').first();
  await expect(callout).toBeVisible();
  await expect(callout).toContainText('adaptive chosen-ciphertext');
  // Before, not after: the caveat must precede the results region in the DOM.
  const order = await page.evaluate(() => {
    const c = document.querySelector('#act4 .callout-caveat');
    const out = document.querySelector('#boom-out');
    if (!c || !out) return -1;
    return c.compareDocumentPosition(out) & Node.DOCUMENT_POSITION_FOLLOWING ? 1 : 0;
  });
  expect(order).toBe(1);
});

test('every measured rate on screen carries its sample size (invariant I2)', async ({ page }) => {
  await boot(page);
  // Each measuring panel must print a sample size beside its rate.
  await expect(
    page.locator('#decay-out .stat').filter({ hasText: 'measured' }).first()
  ).toContainText('pairs');
  await expect(
    page.locator('#imp-out .stat').filter({ hasText: 'pairs encrypted' })
  ).toContainText('keys \u00d7 128 pairs');
  await expect(
    page.locator('#boom-out .stat').filter({ hasText: '95% interval' })
  ).toContainText('quartets');
  await expect(
    page.locator('#switch-out .stat').filter({ hasText: 'switch measured' })
  ).toContainText('every one tried');
});

test('the scripture footer is the last visible element, verbatim and once', async ({ page }) => {
  await boot(page);
  const footers = page.locator('.scripture-footer');
  await expect(footers).toHaveCount(1);
  await expect(footers).toHaveText(
    'So whether you eat or drink or whatever you do, do it all for the glory of God. — 1 Corinthians 10:31'
  );
  const isLast = await page.evaluate(() => {
    const f = document.querySelector('.scripture-footer');
    return f !== null && document.body.lastElementChild === f;
  });
  expect(isLast).toBe(true);
});

// ── Rapid changes never pair one input with another's evidence ─────────────

/**
 * The integration half of latest-request-wins (`src/ui/latest.test.ts` is the
 * unit half, where responses are reordered directly).
 *
 * The hazard is specific: changing the S-box starts five Worker jobs, and a
 * slower earlier job answering after a faster later one would paint the previous
 * S-box's numbers under the new S-box's label. For a page whose whole argument is
 * "these numbers came from this cipher", that is the worst failure available, and
 * it is invisible in a screenshot.
 *
 * Twenty toggles as fast as the harness can issue them, then one check that the
 * evidence on screen belongs to the table now selected. The check is a real
 * re-derivation rather than a label comparison: the two S-boxes have different
 * maximum DDT entries, so the marked cells in Act 5's tables and the switch
 * measurement differ between them.
 */
test('twenty rapid S-box toggles never leave one table’s numbers under the other’s label', async ({
  page,
}) => {
  await boot(page);
  const select = page.locator('#global-sbox');
  for (let i = 0; i < 20; i++) {
    await select.selectOption(i % 2 === 0 ? 'strong' : 'weak');
  }
  // Land on a known one and wait for the page to settle completely.
  await select.selectOption('strong');
  await expect(page.locator('#switch-out')).not.toHaveAttribute('aria-busy', 'true');
  await expect(page.locator('#decay-out')).not.toHaveAttribute('aria-busy', 'true');
  await expect(page.locator('#boom-out')).not.toHaveAttribute('aria-busy', 'true');

  // RE-DERIVATION against the S-box the page is NOW printing.
  const sbox = await readSboxFromPage(page);
  expect(sbox, 'the page must be printing the PRESENT S-box').toEqual([
    0xc, 0x5, 0x6, 0xb, 0x9, 0x0, 0xa, 0xd, 0x3, 0xe, 0xf, 0x8, 0x4, 0x7, 0x1, 0x2,
  ]);
  const bct = deriveBCT(sbox);
  const rows = page.locator('#switch-out table').first().locator('tbody tr');
  await expect(rows).toHaveCount(4);
  for (let i = 0; i < 4; i++) {
    const beta = parseHexByte((await rows.nth(i).locator('td').nth(0).textContent()) ?? '');
    const gamma = parseHexByte((await rows.nth(i).locator('td').nth(1).textContent()) ?? '');
    const measured = ((await rows.nth(i).locator('td').nth(4).textContent()) ?? '').trim();
    const expected = bct[(beta >> 4) & 0xf][(gamma >> 4) & 0xf] * bct[beta & 0xf][gamma & 0xf];
    expect(measured, `row ${i} must describe the S-box now selected`).toBe(`${expected}/256`);
  }
  // And the teaser, which is the first thing a reader sees, moved with it.
  const teaserCells = await page.locator('#teaser .teaser-cell-val').allTextContents();
  const bh = 0x0;
  const bl = 0x8;
  const gh = 0x1;
  const gl = 0x0;
  expect(teaserCells[1]).toBe(`${bct[bh][gh]}/16 and ${bct[bl][gl]}/16`);
});

test('a panel is marked busy while it runs and settles afterwards', async ({ page }) => {
  await boot(page);
  // `aria-busy` is what tells a screen reader to hold its announcement rather
  // than read a half-built result. Asserted as a real transition, not a
  // stylesheet class.
  await page.locator('#imp-keys').selectOption('65536');
  const busySeen = page.waitForFunction(
    () => document.querySelector('#imp-out')?.getAttribute('aria-busy') === 'true'
  );
  await page.locator('#imp-run').click();
  await busySeen;
  await expect(page.locator('#imp-out')).not.toHaveAttribute('aria-busy', 'true');
  await expect(page.locator('#imp-out .verdict-pass')).toHaveCount(1);
});

test('pressing a run button does not steal focus from it', async ({ page }) => {
  await boot(page);
  // Moving focus to a result is the usual well-meant mistake: it loses the
  // reader's place and, for a keyboard user, their position in the control row.
  await page.locator('#sieve-run').focus();
  const before = await runId(page, '#sieve-out');
  await page.locator('#sieve-run').click();
  await awaitRerender(page, '#sieve-out', before);
  await expect(page.locator('#sieve-run')).toBeFocused();
  // And the result is next in reading order after the control that produced it.
  const order = await page.evaluate(() => {
    const btn = document.querySelector('#sieve-run');
    const out = document.querySelector('#sieve-out');
    if (!btn || !out) return -1;
    return btn.compareDocumentPosition(out) & Node.DOCUMENT_POSITION_FOLLOWING ? 1 : 0;
  });
  expect(order).toBe(1);
});

test('each panel announces ONE sentence, not its whole contents', async ({ page }) => {
  await boot(page);
  // The live regions are small and separate from the result containers, so a
  // rerun produces one concise announcement rather than re-reading every chart,
  // table and verdict in the panel.
  for (const id of ['#decay-out-announce', '#imp-out-announce', '#sieve-out-announce', '#boom-out-announce', '#switch-out-announce']) {
    const node = page.locator(id);
    await expect(node).toHaveAttribute('role', 'status');
    await expect(node).toHaveAttribute('aria-live', 'polite');
    const text = ((await node.textContent()) ?? '').trim();
    expect(text.length, `${id} must say something`).toBeGreaterThan(10);
    // One or two sentences, not a panel's worth of prose.
    expect(text.length, `${id} announcement is ${text.length} chars: too long to hear`).toBeLessThan(220);
  }
  // And the containers they describe are NOT themselves live regions.
  for (const id of ['#decay-out', '#imp-out', '#sieve-out', '#boom-out', '#switch-out', '#walk-out']) {
    await expect(page.locator(id)).toHaveAttribute('role', 'region');
    expect(await page.locator(id).getAttribute('aria-live')).toBeNull();
  }
});

test('the share link round-trips every control', async ({ page }) => {
  await boot(page);
  await page.locator('#imp-alpha').fill('0x04');
  await page.locator('#imp-rounds').selectOption('4');
  await page.locator('#sieve-key').fill('0xabcd');
  await page.locator('.seg-btn[data-case="amplified"]').click();
  await expect(page.locator('.seg-btn[data-case="amplified"]')).toHaveAttribute('aria-pressed', 'true');

  // The page SHOWS the link as well as copying it, so this reads what a reader
  // would see -- which is also the path that runs when a clipboard write is
  // refused, as it is in plenty of contexts.
  await page.locator('#share-run').click();
  await expect(page.locator('#share-url')).toHaveCount(1);
  const url = (await page.locator('#share-url').textContent()) ?? '';
  expect(url).toContain('alpha=0x04');
  expect(url).toContain('irounds=4');
  expect(url).toContain('key=0xabcd');
  expect(url).toContain('case=amplified');

  // Follow it, and the controls come back.
  await page.goto(url);
  await expect(page.locator('#imp-alpha')).toHaveValue('0x04');
  await expect(page.locator('#imp-rounds')).toHaveValue('4');
  await expect(page.locator('#sieve-key')).toHaveValue('0xabcd');
  await expect(page.locator('.seg-btn[aria-pressed="true"]')).toHaveAttribute('data-case', 'amplified');
});

test('a share link cannot inject a value the controls do not offer', async ({ page }) => {
  // Query parameters are untrusted input. Every consumer re-validates against its
  // own option list, so a hostile link degrades to the default rather than
  // putting an arbitrary string into a control.
  await page.goto('./?sbox=evil&irounds=99&case=nope&ikeys=1e9&alphas=7,7,7');
  for (const p of ['#decay-out', '#imp-out', '#sieve-out', '#boom-out', '#switch-out']) {
    await expect(page.locator(p)).not.toHaveAttribute('data-run', '0');
  }
  await expect(page.locator('#global-sbox')).toHaveValue('weak');
  await expect(page.locator('#imp-rounds')).toHaveValue('3');
  await expect(page.locator('#imp-keys')).toHaveValue('256');
  await expect(page.locator('#sieve-alphas')).toHaveValue('4,10');
  await expect(page.locator('.seg-btn[aria-pressed="true"]')).toHaveAttribute('data-case', 'ladder');
});

test('Reset everything really restores every shipped default', async ({ page }) => {
  await boot(page);
  await page.locator('#global-sbox').selectOption('strong');
  await page.locator('#imp-alpha').fill('0x04');
  await page.locator('#imp-keys').selectOption('4096');
  await page.locator('#decay-keys').selectOption('2048');
  await page.locator('#boom-keys').selectOption('3000');
  await page.locator('.seg-btn[data-case="control"]').click();
  await expect(page.locator('.seg-btn[data-case="control"]')).toHaveAttribute('aria-pressed', 'true');

  const before = await runId(page, '#sieve-out');
  await page.locator('#reset-all').click();
  await awaitRerender(page, '#sieve-out', before);

  await expect(page.locator('#global-sbox')).toHaveValue('weak');
  await expect(page.locator('#imp-alpha')).toHaveValue('0x0a');
  await expect(page.locator('#imp-delta')).toHaveValue('0x01');
  await expect(page.locator('#imp-keys')).toHaveValue('256');
  await expect(page.locator('#decay-keys')).toHaveValue('256');
  await expect(page.locator('#boom-keys')).toHaveValue('512');
  await expect(page.locator('.seg-btn[aria-pressed="true"]')).toHaveAttribute('data-case', 'ladder');
  // And the evidence came back with them.
  await expect(page.locator('#imp-out .verdict-pass .verdict-label')).toContainText('IMPOSSIBLE');
});

test('the run metadata says how long it took and which thread ran it', async ({ page }) => {
  await boot(page);
  for (const id of ['#decay-out-meta', '#imp-out-meta', '#sieve-out-meta', '#boom-out-meta']) {
    await expect(page.locator(id)).toContainText(/\d+ ms/);
    await expect(page.locator(id)).toContainText(/worker thread|main thread/);
  }
});
