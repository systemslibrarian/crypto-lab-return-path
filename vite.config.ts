import { defineConfig } from 'vitest/config';

/**
 * Ships to GitHub Pages under the repo-name subpath, so `base` must be the real
 * repository name. Every asset reference in the page is relative (`./…`) or a
 * `data:` URI; a root-absolute `/foo` 404s under a project subpath.
 */
export default defineConfig({
  base: '/crypto-lab-return-path/',
  build: { target: 'es2022' },
  worker: { format: 'es' },
  test: {
    // e2e/ holds Playwright specs. Without this they are collected as unit
    // tests, fail to find Playwright's fixtures, and the run reports a false red.
    include: ['src/**/*.test.ts'],
    environment: 'node',
    /*
     * This suite exhausts a 2^16 key space on purpose. Eleven tests encrypt the
     * full 256-plaintext codebook under all 65 536 master keys -- 16.7 million
     * encryptions each -- because on a cipher this small an impossibility claim
     * can be CHECKED rather than argued, and that is the point of the lab.
     * Measured on this machine the slowest is 4.4s and the whole file set runs in
     * about 90s.
     *
     * Vitest's 5s default is therefore wrong for these, and the fix is a budget
     * that says so -- not fewer keys. Raising it is only safe because the
     * measured durations are recorded here and beside each test: a run that
     * suddenly takes 60s is a real regression and this still catches it.
     */
    testTimeout: 120_000,
  },
});
