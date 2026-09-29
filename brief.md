# Build brief — crypto-lab-return-path

Written against `audits/_MASTER-TEMPLATE.md` (copy it into this repo alongside this brief). The template is binding; disagreements go in the PR description.

---

## NEW DEMO BRIEF

| Field | Value |
|---|---|
| Repo name | `crypto-lab-return-path` (check the catalog for a name collision first) |
| Short name (H1) | Return Path |
| Subtitle (spec label) | Impossible differentials · Boomerang (Wagner 1999) · BCT (Cid et al. 2018) |
| One-liner | When no single differential survives enough rounds, split the cipher in half and chain two short ones, or use a difference that can *never* happen. |
| Concept to teach | Plain differential cryptanalysis needs one high-probability trail through the whole cipher, and that fails as rounds grow. Two second-generation techniques work on the same toy cipher learners already broke. **Impossible differential** ("miss in the middle") uses a difference with probability exactly 0 to sieve out wrong keys. **Boomerang** joins two short trails, one through each half, through a quartet of plaintexts, and it returns with probability about p²q², though that estimate can be wrong at the switch. |
| Primitives / spec | The same toy SPN used by `crypto-lab-biham-lens` and `crypto-lab-matsui-line` (see gate V0). Knudsen, DEAL, 1998; Biham, Biryukov, Shamir, impossible differentials on 31-round Skipjack, EUROCRYPT 1999, and "Miss in the Middle", FSE 1999; Wagner, "The Boomerang Attack", FSE 1999; Murphy, "The Return of the Cryptographic Boomerang", IEEE Trans. IT 2011; Cid, Huang, Peyrin, Sasaki, Song, "Boomerang Connectivity Table", EUROCRYPT 2018 |
| `--accent` | `#F472B6` (proposed; confirm neighbours per `CLAUDE.md`, especially against biham-lens and matsui-line, which will likely sit next to it) |
| Favicon emoji | 🪃 |
| In scope | Measured single-trail decay by rounds; an exhaustive impossible-differential proof on the toy block; impossible-differential key sieve on the last round; boomerang distinguisher with measured return rate against the p²q² prediction; the BCT at the switch, including one case where the naive estimate is wrong |
| Non-goals | Attacks on real ciphers (text references only); related-key boomerangs; rectangle/amplified variants beyond one paragraph; automated trail search (SAT/MILP) |

---

## 1. SCOPE

- **Act 0 — Recap in one screen.** The toy SPN's S-box, permutation, and round keys, shown the way biham-lens shows them so learners recognize the cipher. Link back to biham-lens and matsui-line.
- **Act 1 — Why one trail isn't enough.** Take the best differential trail for 1…R rounds. Compare the predicted probability (product of S-box DDT entries) with the measured probability over many random keys. Mark where the expected count of right pairs drops below 1 for the full codebook.
- **Act 2 — A difference that never happens.** Build an impossible differential by miss-in-the-middle: a forward trail with probability 1 to a middle difference pattern, a backward trail with probability 1 to an incompatible pattern. Then **prove** it for this block size by exhaustive enumeration of all plaintext pairs with the input difference, over many random keys, counting zero occurrences. State exactly how many keys were checked, and show that the structural argument, not the enumeration, is what covers all keys.
- **Act 3 — Impossible-differential key sieve.** Partially decrypt the last round under each candidate subkey. Any candidate that produces the impossible difference is eliminated. Show the surviving-key count falling as pairs are added, and that the true subkey is never eliminated.
- **Act 4 — Boomerang.** Split E = E1 ∘ E0. Pick trail α→β through E0 (probability p) and γ→δ through E1 (probability q). Run the quartet procedure: P, P⊕α → C, C′ → C⊕δ, C′⊕δ → decrypt → check the α difference. Plot the measured return rate against p²q² and against random (2⁻ⁿ).
- **Act 5 — The switch lies sometimes.** At a single S-box switching layer, show one case where the p²q² independence assumption fails, with a return rate much lower (incompatible, as Murphy observed) or higher (ladder/S-box switch) than predicted. Compute the S-box's BCT and show that it explains the measured rate where the DDT doesn't. Keep the claim scoped to that one switching layer.
- **Act 6 — Why it matters.** These techniques broke or reduced real designs (Skipjack reduced to 31 rounds; boomerang results on reduced-round AES variants). Keep this as text, with citations checked per V3.

## 2. SECURITY / CORRECTNESS INVARIANTS

- **I1.** The toy SPN is byte-for-byte the cipher in biham-lens (V0). The encryption KATs from that repo pass here unchanged.
- **I2.** Every probability shown as "measured" comes from a run in the page, and the sample size is shown next to it.
- **I3.** DDT and BCT are computed from the S-box in-page. The claims suite recomputes both by brute force independently (§4.1b re-derivation). Rows of the DDT sum to 2^m. Check the BCT's first-row/first-column identity properties (V2).
- **I4.** The impossibility claim in Act 2 is backed by the exhaustive count. If a single occurrence appears, the page says the differential is **not** impossible. That verdict gets a §4.1c mutation test.
- **I5.** The key sieve never eliminates the true subkey. Test this with a fixed seed and random seeds.
- **I6.** The boomerang attack model (chosen plaintext *and* adaptive chosen ciphertext) is stated on screen before Act 4 runs.

## 3. ARCHITECTURE

- `spn` — the toy cipher, imported or vendored from biham-lens with provenance recorded. Needs decryption for the boomerang.
- `tables` — DDT and BCT from the S-box.
- `trails` — hand-specified trails for each act (no automated search), each with its predicted probability computed from `tables`.
- `experiments` — pure functions returning counts; run in a Worker.
- Charts read from typed arrays.

## 4. UI

Standard hero roles (subtitle = spec label; description = what's demonstrated; why-box = real-world stakes). Demo mode follows the single storyline: the ordinary trail dies → an impossible event → keys eliminated → the boomerang returns → the BCT explains the anomaly. DDT/BCT tables, trail notation and probability plots live in Full-lab mode. Controls: rounds R, number of keys, number of pairs/quartets, split point for E0/E1. Every run shows sample size and elapsed time.

## 5. VISUAL SEMANTICS

- Trail diagrams through the SPN state are active S-boxes shaded. For impossible differentials, the forward and backward trails meet in the middle with the contradiction highlighted.
- The boomerang is drawn as the quartet square (P, P′, Q, Q′ / C, C′, D, D′). Don't draw a path that implies a single trail through the full cipher.
- No decorative motion; the return animation only replays real quartets.

## 6. EDGE CASES

- Too few quartets → measured rate 0 even when the expected rate is positive. Show a confidence interval, not a verdict.
- A split point where no useful trails exist → say so.
- Random-key variance: show spread across keys, not one run.

## 7. EXTENSION SEAMS

- Rectangle / amplified boomerang (no adaptive decryption).
- Related-key boomerang.
- Truncated differentials.
- A trail-search panel (MILP / SAT) as a later lab.

---

## Tests (`e2e/claims.spec.ts`)

- The SPN KATs from biham-lens.
- DDT/BCT brute-force re-derivation.
- The impossible differential has zero occurrences over the exhaustive enumeration for the tested keys (and a §4.1d test that the page's "impossible" claim is scoped to what was enumerated plus the structural argument).
- The true subkey survives the sieve.
- The measured boomerang rate is within a stated CI of the BCT-based prediction for the Act 5 switch, and outside it for the naive p²q² prediction. The case must be chosen so this holds, and it must be recorded.
- A §4.1c mutation for every verdict.

## Verification gates

- **V0.** Grep biham-lens and matsui-line for the actual toy SPN (block size, S-box, permutation, round count, key schedule). Reuse it exactly. Don't assume it is Heys' tutorial SPN until the code says so. Report what was found.
- **V1.** Wagner, "The Boomerang Attack", FSE 1999, LNCS 1636, pp. 156–170, for the quartet definition and the p²q² estimate (which assumes independence). Biham–Biryukov–Shamir, EUROCRYPT 1999, pp. 12–23, for impossible differentials and the Skipjack 31-round result; "Miss in the Middle Attacks on IDEA and Khufu", FSE 1999, pp. 124–138. Knudsen 1998 (DEAL) as an **early, independent** use of impossible-differential reasoning. Do **not** call it "the first": Biham had earlier used related impossible-event reasoning on Ladder-DES, and zero DDT entries were already known. Use the history BBS 1999 gives.
  - *Revision note:* Revision 1 said "Knudsen 1998 for the first impossible-differential use". That was a categorical "first" claim the primary source contradicts, so it's removed.
- **V2.** Cid, Huang, Peyrin, Sasaki, Song, "Boomerang Connectivity Table: A New Cryptanalysis Tool", EUROCRYPT 2018, for the BCT definition and the identities the tests check. Murphy, "The Return of the Cryptographic Boomerang", IEEE Trans. IT 57(4), 2011, pp. 2517–2521, for the observation that independently chosen trails can be incompatible and that p²q² can be badly wrong. Attribute the *problem* to Murphy and the *BCT tool* to Cid et al.; never imply Murphy introduced BCT-style analysis. The basic BCT covers a **single S-box switching layer**. Act 5's switch must be exactly that, and the page must not generalize the BCT to multi-round middle sections.
- **V3.** Any real-cipher result named in Act 6: exact rounds and complexity from the primary paper, or drop it.

## Honesty panel (draft)

- This cipher is a teaching toy with a 16-bit-scale block (confirm the size at V0). The exhaustive checks here are impossible for real ciphers, where impossibility is argued structurally.
- Boomerang needs an adaptive chosen-ciphertext oracle. That is a strong attacker model and it is why rectangle attacks exist.
- p²q² is an estimate that assumes the two halves behave independently. Act 5 exists because that assumption fails.

## Category

ATTACKS. Grep `CATEGORIES`, and don't assume counts.