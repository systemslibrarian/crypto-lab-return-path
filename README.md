# Return Path

**Impossible differentials · Boomerang (Wagner 1999) · BCT (Cid et al. 2018)**

When no single differential survives enough rounds, split the cipher in half and
chain two short ones — or use a difference that can *never* happen.

**[Live demo →](https://systemslibrarian.github.io/crypto-lab-return-path/)**

---

## What It Is

A browser lab for the two second-generation differential techniques, run against
the **same toy SPN cipher** as [Biham Lens](https://github.com/systemslibrarian/crypto-lab-biham-lens)
and [Matsui Line](https://github.com/systemslibrarian/crypto-lab-matsui-line) — 8-bit
block, 16-bit key, four rounds of key-mix / 4-bit substitution / bit permutation.
The cipher is **reimplemented here and checked exhaustively against the sibling
lab's own function** — the S-box, permutation and key-schedule constants are
copied, and the tests transcribe biham-lens's `encrypt` longhand and compare
every plaintext against it. "Byte for byte" is the result, not the method, and
the difference matters: the agreement is a test, not a claim (see
**Build & Verify**).

Three primitives, all hand-rolled so the internals are inspectable:

- **The cipher** — `src/crypto/spn.ts`. The S-box and bit permutation of
  `crypto-lab-biham-lens`, its rotate-left-4 key schedule, and its round
  structure. The round count runs to six, past the published four, because on
  this cipher the interesting decay happens after round four.
- **The DDT** (difference distribution table) — Biham and Shamir's tool.
  `DDT[a][b]` counts the inputs that turn input difference `a` into output
  difference `b` through one S-box. A zero entry is the statement the impossible
  differential is built on.
- **The BCT** (Boomerang Connectivity Table) — Cid, Huang, Peyrin, Sasaki and
  Song, EUROCRYPT 2018. `BCT[a][b]` counts the inputs for which the boomerang's
  *round trip* through one S-box — in with difference `a`, shifted by `b`, back
  out — returns `a`. Both tables are computed from the S-box in the page.

**Security model.** Act 3 is a chosen-plaintext attack. Acts 4 and 5 need chosen
plaintexts *and* an **adaptive chosen-ciphertext oracle**: the second pair of
ciphertexts is chosen only after the first pair comes back. That is a strong
assumption, stated on screen before the boomerang runs, and it is why rectangle
attacks — which drop the decryption half — exist.

**Not production cryptography.** An 8-bit block holds 256 plaintexts and a
16-bit key 65 536 keys. This cipher is a teaching target built to be broken in
front of you. Nothing here is a statement about a cipher anyone deploys.

### The one result worth the visit

An impossible differential proves a difference can *never* cross three rounds.
The boomerang's switch has a crossing whose one-way table entry is **zero** — it
can never happen in one direction, for any key — and the round trip through that
same crossing closes for **all 256 middle states**. Impossibility in one
direction does not bound a quartet, and the page measures both halves of that
sentence rather than asserting either.

## Exhibits

The page opens on the result: a live teaser showing the two table entries side by
side — `0/16` one way, `16/16` on the round trip — with one action that lands you
in Act 5 with the quartet already stepping. A chapter navigator follows, then the
acts in order.

0. **The cipher you already broke.** The S-box, the bit permutation and the key
   schedule, shown the way the sibling labs show them. A disclosure notes the
   schedule's period of four, which Act 3 later exploits.
1. **One trail is not enough.** The best trail for 1…6 rounds, with three numbers
   per round: the single-trail prediction (a product of DDT entries), the
   differential's real probability (a sum over every trail), and the measured
   rate. The threshold where the expected right pairs in the whole codebook fall
   below one is marked on the chart itself. Two results: the single-trail
   prediction is out by a factor of ten at six rounds, and from four rounds on the
   best trail does not even point at the best differential — a different endpoint
   pair, found by exhausting all 65 025 of them.
2. **A difference that never happens.** A miss-in-the-middle diagram leads: the
   forward-reachable middle differences on one side, the backward-required ones on
   the other, and an explicitly empty intersection between them. Then type any two
   differences and press *Try to make it happen* — the page encrypts real pairs and
   counts, and *all 65 536 keys* checks it against every key the cipher has.
   Changing an input retires the verdict rather than leaving it to look like an
   answer to a question nobody asked.
3. **Eliminating keys with an event that cannot occur.** The three-round
   impossible differential aimed at the last round of the **full four-round
   cipher**. 256 candidates for the final mixing key fall as pairs arrive; the
   true subkey is never eliminated. Pick the weakest sieve and watch it honestly
   run out of data instead of guessing.
4. **The boomerang.** The quartet procedure against the real cipher, with the
   measured return rate set against `p²q²`, against the BCT-corrected estimate,
   and against the same procedure run on **real random permutations** — the null a
   distinguisher has to beat. Intervals are a cluster bootstrap over keys, with
   the narrower pooled interval shown beside them so the cost of assuming
   independence is visible. Degenerate quartets are excluded and counted, the
   per-key spread is drawn as a distribution, and a decomposition reports what
   share of the returns followed the stated trail.
5. **The switch, where the estimate breaks.** The headline exhibit, in two parts.
   A real quartet stepped through eight stages on a square whose corners never
   move — every value produced by the real cipher under a real key — stopping at
   the switch to show the one-way table entry of zero before the round trip closes
   anyway. Then the switch measured on its own over **all 256 middle states**: no
   sampling, no interval, exact. Four cases, of which the BCT explains all four and
   the trail reading gets three wrong. The split point is a control, so you can
   move the switch and watch `p`, `q` and the estimate move with it.
6. **Why anyone cares.** Skipjack, IDEA, COCONUT98, AES-192/256, and the
   Murphy → Cid et al. correction, with round counts checked and complexities
   deliberately not quoted.

Plus a permanent honesty panel, outside every disclosure.

### A note on the palette

The build brief proposed `#F472B6`. This lab ships `#9f88ff` instead, because the
catalog's `CLAUDE.md` fixes a four-colour accent rotation and requires
neighbouring cards to differ: Biham Lens and Matsui Line both use `#ff6b7f`, and
`#F472B6` reads as the same colour beside them. Violet is on-palette and distinct
from all three of this lab's nearest neighbours in the cryptanalysis section.

## When to Use It

Use it to teach why security against one attack is not security; to show the gap
between a trail and a differential; to introduce impossible differentials without
hand-waving the impossibility; and to make the BCT concrete for someone who has
read the definition and not felt it.

**Do NOT use this cipher, or this code, for anything.** An 8-bit block is not
encryption. Do not lift `src/crypto/spn.ts` into a project, do not treat the
sieve as a template for a real attack, and do not read any timing here as
constant-time — nothing in this lab attempts it.

## Live Demo

**<https://systemslibrarian.github.io/crypto-lab-return-path/>**

You can: change the substitution table and watch every measurement rerun; type
your own differences and try to make an impossible one happen; set the round
count in Acts 2 and 3; raise any run to the whole 65 536-key space; move the
boomerang's split point and watch p, q and the estimate move with it; step a real
quartet through the switch one stage at a time; pick a switch that can never
close and see the page refuse to show a quartet; weaken the sieve until it runs
out of data; and copy a link that reproduces any run exactly.

Every run prints its elapsed time and whether a Worker or the main-thread
fallback produced it.

## What Can Go Wrong

The failure modes this page is built around, each reachable in the UI and each
wired to a test:

- **A zero DDT entry does not bound the boomerang.** The lab's negative claim. A
  crossing that is flatly impossible one way can let the round trip through every
  time. Any argument that treats one-way impossibility as a bound on a quartet is
  wrong, and Act 5 is the counterexample.
- **`p²q²` is an estimate, and it misses twice here.** Once at the switch, where a
  trail reading charges for a crossing the round trip need not pay. Once across
  the two backward pairs, which the estimate multiplies as if independent and
  which on this cipher are not. The second is a property of this toy, measured
  and reported, not a general law.
- **A single trail is not the differential.** A trail-based estimate *understates*
  a differential — by a factor of ten at six rounds here — so a designer who
  counts trails can believe a cipher safer than it is.
- **A recovered subkey is not a recovered key.** The sieve returns 8 of the 16
  master-key bits. 256 master keys share the recovered byte.
- **An end-to-end rate cannot be attributed to one trail.** Hundreds of middle
  paths share any two end differences. Act 4 separates them with an instrument
  that reads the key (and says so); Act 5 avoids the problem entirely.
- **The impossible differential covers three rounds, not four.** On the full
  four-round cipher every output difference is reachable from every input
  difference. That is the measured result, not a gap in the search.
- **A one-layer switch can only help the boomerang.** `BCT ≥ DDT` pointwise,
  proven entry by entry in the tests. So Murphy's incompatibility, in the form
  where the real rate falls far *below* the estimate, needs a middle section
  wider than one substitution layer — which this page does not model and does not
  claim to.
- **Small blocks distort the boomerang.** Degenerate quartets, where the
  ciphertext shift happens to equal the pair's own difference, return for free.
  Negligible at 64 bits; percent-scale here. They are excluded and counted — and
  that exclusion moves the random baseline from `1/255` to **`1/253`**, which the
  page uses and the tests derive by enumerating every permutation of a smaller
  block.
- **Pooled intervals lie when the samples are clustered.** The 128 quartets one
  key contributes share its subkeys, so treating them as 128 independent trials
  reports an interval that is too narrow. Every interval here resamples keys.
- **A trail search does not find the best differential.** From four rounds on,
  the endpoint pair joined by the strongest trail is not the pair with the
  strongest differential. A tool that maximises one and reports the other is
  claiming more than it computed, which is why this lab names the two functions
  apart.
- **A trail probability is not a promise about your key.** Only 6 144 of the
  65 536 keys carry a quartet realising the shipped trail, and for one of the four
  cases **no key does**. The page reports which key it found and how many it tried.

## Real-World Usage

Round counts are from the primary papers. **Data and time complexities are
deliberately not quoted anywhere in this lab** — they were not verified against
the primary sources while it was written, and a confidently wrong exponent is
worse than no exponent.

- **Skipjack, 31 of 32 rounds.** Biham, Biryukov and Shamir broke Skipjack
  reduced to 31 rounds with a 24-round impossible differential (EUROCRYPT 1999) —
  at the time the best known attack on the cipher.
- **IDEA and Khufu.** The same authors named the technique "miss in the middle"
  and applied it to both (FSE 1999).
- **COCONUT98.** Wagner introduced the boomerang against a cipher designed to be
  provably secure against conventional differential cryptanalysis. It was. Two
  halves still got through.
- **AES-192 and AES-256, full round count.** Biryukov and Khovratovich's
  **related-key** boomerangs (ASIACRYPT 2009) reach both, and the switching
  techniques they introduced — the ladder switch and the S-box switch — are what
  this lab's first switch case is an instance of. Related-key is a far stronger
  model than the single-key one here, and these results do not threaten AES as
  deployed. This lab does not implement related-key boomerangs.
- **The correction.** Murphy (IEEE Trans. IT, 2011) showed independently chosen
  trails can be incompatible, so `p²q²` can be badly wrong. Cid, Huang, Peyrin,
  Sasaki and Song answered it with the BCT (EUROCRYPT 2018) — exact accounting for
  a one-layer switch, which is what Act 5 measures. The *problem* is Murphy's; the
  *tool* is Cid et al.'s.

Knudsen's DEAL report (1998) is an early, independent use of
impossible-differential reasoning. It is **not** the first: Biham had already used
related impossible-event reasoning on Ladder-DES, and zero DDT entries were long
known. Follow the history in Biham–Biryukov–Shamir 1999.

## How to Run Locally

```sh
git clone https://github.com/systemslibrarian/crypto-lab-return-path.git
cd crypto-lab-return-path
npm install
npm run dev          # http://localhost:5173/crypto-lab-return-path/
```

```sh
npm test             # 155 unit tests (Vitest)
npm run build        # tsc --noEmit && vite build
npx playwright install chromium
npm run test:a11y    # the axe WCAG 2.1 A/AA gate
npm run test:claims  # 50 claims tests + 7 entry-experience gates
```

`npx playwright install chromium` — never `--with-deps`. That apt step wedged 547
runs across this fleet, and the GitHub runner image already carries the libraries
Chromium needs.

## Related Demos

This is the third lab on one cipher, and the three are meant to be read in order.

- **[Biham Lens](https://systemslibrarian.github.io/crypto-lab-biham-lens/)** —
  differential cryptanalysis, and where this cipher is defined. Start here if
  "differential" is new; Act 1 assumes it.
- **[Matsui Line](https://systemslibrarian.github.io/crypto-lab-matsui-line/)** —
  linear cryptanalysis on the same cipher, and the piling-up lemma's prediction
  missing. The same shape of lesson as Act 1 here, in different mathematics.
- **[Misty Lens](https://systemslibrarian.github.io/crypto-lab-misty-lens/)** —
  the related-key *sandwich* distinguisher on MISTY1 and KASUMI: the boomerang's
  close relative, in the stronger attack model this lab does not enter.
- The rest of the suite: **[Crypto Lab](https://crypto-lab.systemslibrarian.dev/)**.

## Build & Verify

**155 unit tests (Vitest), all passing.** The checks that matter most:

| What | Where |
|---|---|
| The cipher agrees with `crypto-lab-biham-lens` on every plaintext — 1 024 keys with the textbook S-box, 256 with PRESENT — against a longhand transcription of that lab's own function | `src/crypto/spn.test.ts` |
| 16 pinned known-answer vectors, and the reference agreeing with all 16 | `src/crypto/spn.test.ts` |
| The round-key extension leaves rounds 0–4 untouched, for **all 65 536 master keys** | `src/crypto/spn.test.ts` |
| Only `K_R` is needed to sieve — checked against all 256 values of `K_{R-1}` | `src/crypto/spn.test.ts` |
| DDT and BCT recomputed by independent brute force, and the three BCT identities (first row and column `= 2ⁿ`, `BCT ≥ DDT` pointwise, entries even) | `src/crypto/tables.test.ts` |
| Reachability matches **exhaustive enumeration over all 65 536 keys**, in both directions — nothing achieved that was called impossible, and nothing called reachable that never occurs | `src/crypto/trails.test.ts` |
| The 3-round impossible differential rules out exactly the 30 single-active-nibble differences, with **zero occurrences in 8 388 608 pairs** | `src/crypto/trails.test.ts`, `experiments.test.ts` |
| There is no 4-round impossible differential, for any input difference, either S-box | `src/crypto/trails.test.ts` |
| Invariant I5: the sieve never eliminates the true subkey — 400 keys, fixed and random seeds | `src/crypto/experiments.test.ts` |
| The switch measured over all 256 middle states equals the BCT for **all 65 025 (β, γ) pairs** | `src/crypto/experiments.test.ts` |
| The boomerang beats a real random-permutation null with non-overlapping intervals, and `p²q²` overstates the measurement | `src/crypto/experiments.test.ts` |
| The random-permutation null is `1/(N−3)`, not `1/(N−1)` — derived by enumerating **all 24 and all 40 320 permutations** of a 4- and an 8-element block under the same exclusion rule | `src/crypto/experiments.test.ts` |
| Intervals resample keys, not quartets: the cluster bootstrap is wider than the pooled Wilson interval, and the distinguisher survives the correction at the shipped default | `src/crypto/experiments.test.ts` |
| `bestTrail` and `bestDifferential` each maximise what their name says, against an exhaustive sweep of all 65 025 endpoint pairs — and disagree from four rounds on | `src/crypto/trails.test.ts` |
| Latest-request-wins: out-of-order and twenty-deep responses authorise exactly one render, the newest, and a stale answer cannot clear the busy state | `src/ui/latest.test.ts` |

**The WCAG 2.1 A/AA gate** (`e2e/a11y.spec.ts`) drives the lab through every
state it teaches — all eight quartet steps, all four switch cases, every refusal
path, both S-boxes, every disclosure — and scans each at 1280px and 380px. It
asserts axe's `violations` **and** its `incomplete` bucket, computes contrast
arithmetically over composited surfaces, measures non-text contrast and generated
content against a ratcheted baseline (which is **empty**), and checks reflow,
scroller keyboard reach and focus visibility. Zero violations; the deploy is
blocked if that changes.

**The claims suite** (`e2e/claims.spec.ts`, 43 tests) checks the page tells the
truth: the DDT, the BCT, the switch rate and the miss-in-the-middle diagram's
forward set are all re-derived in the test from the S-box the page itself prints;
every failure path names its actual cause; a changed input retires its verdict
while re-entering the same value does not; and the negative claim's fixture is
reached through the UI, shown to be green in every check, and asserted to carry
its limitation on screen, outside every disclosure.

**The entry gate** (`e2e/entry.spec.ts`, 7 tests) enforces the things that make
the page enterable rather than merely correct: a real interaction inside the
first desktop viewport, the headline paradox complete within two phone screens,
both of its numbers on screen and matching the page's own S-box, the teaser's one
action landing on a stepped quartet, and a **ratcheted ceiling on arrival-state
copy** — 2 200 words, down from 3 181 before the reduction pass. The ceiling may
be lowered, never raised.

## Performance

Everything runs in a Web Worker, with a main-thread fallback so a Worker that
fails to load leaves a slow page rather than an empty one. Every panel shows its
elapsed time and which path produced it. On this machine: the arrival state
settles in well under a second; the full 65 536-key exhaustive run in Act 2 takes
about 3.5 seconds; Act 5's switch measurement is 256 operations and is instant.

Every run prints its sample size, and every measured rate carries a confidence
interval computed by resampling **keys** — the independent unit — rather than
quartets. Rapid changes cannot show one input's label beside another's evidence:
each panel issues a monotonic request ticket and drops any response that is no
longer the newest, including for the purpose of clearing its busy state.

---

*One of the browser demos in the [Crypto Lab](https://crypto-lab.systemslibrarian.dev/) suite.*

*"So whether you eat or drink or whatever you do, do it all for the glory of God." — 1 Corinthians 10:31*
