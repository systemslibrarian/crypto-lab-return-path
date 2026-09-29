/**
 * Known WCAG 1.4.11 / generated-content findings in this lab, captured through
 * the gate's own path so the baseline and the check cannot disagree.
 *
 * THIS FILE IS A TO-DO LIST, NOT A SET OF EXEMPTIONS. The gate ratchets on it:
 *   - a finding NOT listed here fails the run, so a regression cannot land;
 *   - a listed finding whose ratio gets WORSE fails, so the list cannot rot;
 *   - a listed finding that no longer appears ALSO fails, so a fixed entry must
 *     be deleted and the file can only shrink toward empty.
 * The last rule is what stops an allowlist becoming a permanent exemption.
 *
 * `unverified: true` marks an absolutely-positioned pseudo-element. It can paint
 * outside its host and the oracle measures it against the host's backdrop, so
 * that ratio is NOT trustworthy - hand-measure before acting on it.
 *
 * IT IS EMPTY, AND THAT IS THE POINT - this is the terminal state of the
 * ratchet, not an unrun check. It is empty because the stylesheet was authored
 * against this oracle rather than corrected by it: `src/style.css` splits the two
 * jobs a border does, `--border` for decorative dividers and `--edge` for
 * control boundaries, and every button, input and select draws its edge from
 * `--edge` (measured 4.30:1 on `--bg`, 4.03:1 on `--surface`, 3.68:1 on
 * `--surface-2`). The two controls that repaint their border to match their own
 * accent fill - `.btn-primary` and a pressed `.seg-btn` - have no edge of their
 * own and pass on fill-against-surround instead, at 6.45:1 on `--surface`. The
 * two entries most of this fleet carries for the shared bar's `.cl-btn` are
 * absent for the same reason as in `crypto-lab-schnorr-forge`: it draws its edge
 * from `--cl-ink`.
 *
 * A run with `NT_BASELINE_CAPTURE=1` set prints every finding through this same
 * path and asserts nothing, which is how this file is regenerated.
 */
export const NONTEXT_BASELINE: Record<
  string,
  { ratio: number; required: number; unverified: boolean }
> = {};
