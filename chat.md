# Return Path: What Would Make This a 10/10 Demo

## Executive verdict

**Current assessment: 8/10.**

This is already an unusually rigorous cryptography demo. Its strongest qualities are not cosmetic: it computes the experiments for real, scopes claims carefully, exposes failure paths, and tests the prose against independently derived results. The gap to 10/10 is that the product does not yet present those strengths with the same precision.

At desktop size the page is about **10,800 px tall** and contains roughly **3,900 visible words**. At 390 px wide it grows to about **20,400 px**, with the headline switch result beginning around **15 phone screens down**. The result feels more like an excellent interactive paper than an irresistible demonstration.

The winning revision would do three things:

1. Put the surprising result first: **a one-way-impossible S-box transition can permit every boomerang round trip**.
2. Turn the core mechanisms into diagrams that can be understood before the prose is read.
3. Fix a few correctness and asynchronous-state issues so the demo's exceptional trust story is airtight.

## What is already excellent

- **Real computation, not canned output.** The experiments run against the actual toy SPN, with exhaustive modes where the small state space permits them.
- **A superb honesty model.** The page distinguishes a trail from a differential, a subkey from a master key, a toy from a deployed cipher, and a one-layer BCT result from a multi-round claim.
- **Claims are tested as claims.** The browser suite re-derives DDT and BCT values from the S-box printed by the page instead of merely repeating implementation formulas.
- **Failure states are first-class.** Invalid differences, reachable differentials, weak sieves, incompatible switches, and stale verdict retirement are all treated as part of the lesson.
- **Accessibility engineering is far above normal demo quality.** The test suite covers reflow, contrast, focus, generated content, disclosures, and narrow layouts across driven states.
- **The story is intellectually coherent.** Trail decay leads to impossibility, impossibility becomes a sieve, and the boomerang leads naturally to the BCT correction.

Do not lose this rigor while simplifying the presentation. The page should become easier to enter, not shallower.

## Priority 1: Make the headline result the opening experience

The most memorable result is currently buried in Act 5. Open with a compact, live teaser immediately below the hero:

> **Impossible one way. Guaranteed on the round trip.**  
> DDT entry: 0/16. BCT entry: 16/16. Step through one real quartet.

Show the two values side by side, draw the outbound and return paths, and provide one primary action: **Step the quartet**. After the result lands, link into the existing sequence with **How can both be true? Start with Act 1**.

Add a sticky chapter navigator for `Trail dies`, `Impossible`, `Key sieve`, `Boomerang`, and `Switch explains it`. On mobile, make it a compact horizontally scrollable stepper.

**Acceptance criteria**

- A first-time visitor reaches a meaningful interaction in the first viewport on desktop and by the second viewport on mobile.
- The central paradox and its exact `0/16` versus `16/16` evidence are visible within ten seconds.
- Act 5 is reachable in one action without removing the rigorous Acts 0–4 path.

## Priority 2: Replace data walls with mechanism diagrams

The page currently gives charts, stat tiles, chips, tables, verdicts, and caveats nearly equal visual weight. The key ideas need custom visual grammar.

### Impossible differential

Draw a real miss-in-the-middle diagram:

- Input difference on the left.
- Forward-reachable middle states flowing toward the center.
- Output difference on the right.
- Backward-required middle states flowing toward the center.
- A visibly empty intersection at the center, labelled **no shared state**.
- Enumeration as supporting evidence below the structural proof, not as the main picture.

### Boomerang

Replace the generic quartet cards with a stable square:

```text
P1 ---- alpha ---- P2
 |                  |
 E                  E
 |                  |
C1 ---- delta ---- C2
 |                  |
XOR delta       XOR delta
 |                  |
C3 ---------------- C4
 |                  |
D                  D
 |                  |
P3 ---- alpha? --- P4
```

Animate only the current real step. Keep completed values visible, dim future steps, and highlight the switch layer when the DDT/BCT interpretation changes.

### Trail decay

Make the threshold crossing the dominant chart event. Label the exact first round where expected right pairs fall below one directly on the chart; move detailed tables into disclosure.

**Acceptance criteria**

- In a five-person usability check, at least four people can explain the empty-middle proof and quartet return path without reading the long-form paragraphs.
- Each act has one visually dominant claim, one primary action, and one supporting-detail disclosure.
- Raw tables remain available but no longer compete with the conclusion by default.

## Priority 3: Cut the reading cost without cutting the substance

The opening currently asks visitors to read the hero, a long `What this is` card, a global-control explanation, and Act 0 before the first narrative experiment. On mobile, the first control appears roughly 2.4 screens down.

Use progressive disclosure:

- Reduce the hero to one promise and one concrete surprise.
- Turn `What this is` into three short definitions: **difference**, **impossible differential**, **boomerang**.
- Move historical context and detailed caveats beside the act where each becomes relevant.
- Keep the permanent honesty panel, but begin it with a four-line summary and collapse the detailed limitations individually.
- Put advanced tables, full derivations, and instrumentation details behind consistently named `Inspect the evidence` disclosures.

The target is not fewer facts overall. It is fewer facts before the visitor has a reason to want them.

**Acceptance criteria**

- Cut arrival-state visible copy by roughly 35–45% while retaining all claims in-page.
- Keep ordinary paragraphs near 65–75 characters per line.
- Reduce the mobile path to the headline result from about 15 screens to no more than 2.

## Priority 4: Tighten two mathematical claims

### Correct the random-permutation null

The boomerang implementation excludes degenerate quartets, but the displayed null remains `1/255`. Conditioned on that exclusion, the exact random-permutation return probability is **`1/253`**: the two shifted ciphertexts map to two distinct plaintexts outside the original pair, and each first plaintext has one successful partner among 253 possibilities. Derive this independently and pin it with a test.

Also avoid treating all quartets from one key as independent samples. They share a permutation/key, so a Wilson interval over the pooled quartet count can be too confident. Report uncertainty across keys, using a per-key interval or cluster bootstrap.

**Acceptance criteria**

- The random baseline is derived analytically in a test under the exact same exclusion rule used by the experiment.
- Confidence intervals use keys as the independent sampling unit.
- The default random-null and real-cipher intervals remain visibly distinct after the correction.

### Make Act 1 prove exactly what its verdict says

The trail-selection helper optimizes a single trail, while the verdict generalizes to the best differential. Either compute the globally strongest differential endpoint for each round or narrow the prose to the selected trail and its endpoint differential.

The stronger demo is to show both:

- best single trail;
- best full differential after summing all trails;
- measured rate for that same endpoint pair.

**Acceptance criteria**

- Every `best` label names the quantity actually optimized.
- A test independently enumerates endpoint differentials for this 8-bit cipher and confirms the displayed maximum.

## Priority 5: Prevent stale results during rapid changes

Changing the global S-box starts several asynchronous worker jobs. Rapid toggling can temporarily show the newly selected S-box with results from the previous one and can re-enable a panel before its latest request completes.

Give every panel a monotonically increasing request token and an immutable input snapshot. Only the latest matching response may render or clear `aria-busy`. This matters beyond polish: an educational tool must never put one set of inputs beside another set's evidence, even briefly.

**Acceptance criteria**

- Twenty rapid S-box toggles never produce a visible input/result mismatch.
- Controls stay busy until the latest request settles.
- A Playwright test deliberately delays and reorders worker responses and verifies latest-request-wins behavior.

## Priority 6: Improve nonvisual interaction quality

The automated accessibility coverage is excellent, but large result containers use live status semantics. A screen reader may announce charts, tables, verdicts, and disclosure content together after every rerun even though axe reports no violation.

Use a small dedicated live region for messages such as `Measurement complete: 0 occurrences in 32,768 pairs`. Keep the full result in a normal labelled region and use `aria-busy` while it updates. Test the complete opening and one rerun with VoiceOver, not only automated scanners.

Also give horizontally scrolling mobile tables an explicit affordance and a compact summary before the table.

**Acceptance criteria**

- A rerun produces one concise VoiceOver announcement.
- Focus remains on the initiating control and the result is reachable next in reading order.
- Every mobile table announces or visibly indicates that more columns are available horizontally.

## Priority 7: Reconcile the brief, README, and shipped UI

The documentation is impressive but makes a few claims that should be made exact:

- `Reused byte for byte, not reimplemented` should say the cipher was vendored/reimplemented and checked exhaustively against the sibling lab's behavior, if that is the actual provenance.
- Verify the README's stated cross-check key counts for both S-boxes against the tests.
- `Every rate its interval` should either include Act 1 intervals or be narrowed.
- The brief specifies accent `#F472B6`, while the page currently ships a violet accent.
- The brief promises controls for rounds, quartet count, and split point plus elapsed time; the shipped UI exposes fixed scenarios and key-count controls instead. Update the brief or implement those controls.
- `Break the same cipher two other ways` overstates Act 4, which is a distinguisher, and Act 3, which recovers only half the key. Prefer `attack and distinguish the same toy cipher`.

These are small edits, but this project explicitly sells epistemic care. Documentation precision is part of the demo.

## Priority 8: Give it portfolio-level finish

After the structural work above:

- Add a short, captioned recording or animated image of the real quartet walk to the README.
- Display elapsed time and whether the Worker or fallback performed each run.
- Add a `Share this experiment` action that serializes S-box, differences, sample size, key, and switch case into the URL without including secret material.
- Add `Reset act` and `Reset all` actions so exploration is reversible.
- Show per-key spread as a compact distribution instead of only aggregate prose.
- Respect `prefers-reduced-motion` while keeping the step transition legible.
- Use the brief's pink accent or explicitly document the palette decision; the current dark violet treatment is polished but visually close to many developer demos.

## Recommended implementation order

1. Fix the null model, Act 1 wording/computation, and stale worker responses.
2. Build the above-the-fold switch teaser and chapter navigation.
3. Replace the impossible and boomerang card grids with true mechanism diagrams.
4. Reduce default copy and move depth into consistent disclosures.
5. Refine live-region behavior and manually verify with VoiceOver.
6. Reconcile documentation, add sharing/reset affordances, and record the README demo.

## Definition of 10/10

The finished demo should pass this test:

> A newcomer can state the paradox after ten seconds, explain the mechanism after one minute, inspect the proof after five minutes, and find no place where the page claims more than the experiment establishes.

The repository already satisfies most of the last clause. The path to 10/10 is to make the first three equally strong.