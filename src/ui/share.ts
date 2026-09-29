/**
 * Share and reset.
 *
 * A share link serialises the controls into the query string so a run can be
 * reproduced or sent to someone. It carries the 16-bit demo key deliberately --
 * without it the sieve lands on a different key and the link does not reproduce
 * what the sender saw. That is a toy key for a toy cipher with no secrecy value,
 * and the honesty panel says so rather than leaving a reader to wonder.
 *
 * Nothing else about the page is stateful, so there is nothing else to carry.
 */
export type ShareState = Record<string, string>;

const KEYS = ['sbox', 'alpha', 'delta', 'irounds', 'ikeys', 'alphas', 'srounds', 'key', 'bkeys', 'case', 'split'] as const;

export function readShareState(search: string): ShareState {
  const params = new URLSearchParams(search);
  const out: ShareState = {};
  for (const k of KEYS) {
    const v = params.get(k);
    // Length-capped and character-filtered: the values come from a URL, so they
    // are untrusted input, and every consumer re-validates against its own
    // option list anyway.
    if (v !== null && v.length <= 24 && /^[0-9a-zA-Z,.x_-]*$/.test(v)) out[k] = v;
  }
  return out;
}

export function buildShareUrl(state: ShareState): string {
  const params = new URLSearchParams();
  for (const k of KEYS) if (state[k] !== undefined) params.set(k, state[k]);
  const base = `${window.location.origin}${window.location.pathname}`;
  return `${base}?${params.toString()}`;
}

/**
 * Copy to the clipboard, falling back to selecting the text when the Clipboard
 * API is unavailable or refused -- which it is in plenty of contexts, and a
 * button that silently does nothing is worse than one that shows you the link.
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
