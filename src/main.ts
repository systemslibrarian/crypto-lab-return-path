/**
 * Return Path -- impossible differentials and the boomerang attack, against the
 * toy SPN of crypto-lab-biham-lens and crypto-lab-matsui-line.
 *
 * The page leads with its result: the paradox is above the fold, computed live,
 * one action away from the real exhibit. Behind it the storyline runs in order --
 * the ordinary trail dies, an event that cannot happen turns up, keys fall, the
 * boomerang comes back, and the round-trip table explains why the estimate
 * missed. Depth lives in "Inspect the evidence" disclosures inside each act
 * rather than behind a mode, so nothing a reader might want is gated and nothing
 * they do not want is in the way.
 */
import './style.css';
import { SBOX_LABEL, SBOX_NAMES, type SboxName } from './crypto/sbox.ts';
import { MAX_ROUNDS } from './crypto/spn.ts';
import { el, field } from './ui/dom.ts';
import { cipherPanel } from './ui/cipherPanel.ts';
import { decayPanel } from './ui/decayPanel.ts';
import { impossiblePanel } from './ui/impossiblePanel.ts';
import { sievePanel } from './ui/sievePanel.ts';
import { boomerangPanel } from './ui/boomerangPanel.ts';
import { switchPanel } from './ui/switchPanel.ts';
import { contextPanel, honestyPanel } from './ui/contextPanel.ts';
import { CHAPTERS, chapterNav, teaser, trackTopbarHeight } from './ui/teaser.ts';
import { buildShareUrl, copyToClipboard, readShareState } from './ui/share.ts';

function hero(): HTMLElement {
  return el('div', { class: 'cl-hero' }, [
    el('div', { class: 'cl-hero-main' }, [
      el('h1', { class: 'cl-hero-title', text: 'Return Path' }),
      el('p', {
        class: 'cl-hero-sub',
        text: 'Impossible differentials · Boomerang (Wagner 1999) · BCT (Cid et al. 2018)',
      }),
      el('p', {
        class: 'cl-hero-desc',
        text: 'Two ways to break a cipher no single difference can cross — and the substitution layer where the textbook estimate for one of them turns out to be wrong by a factor of 1600.',
      }),
    ]),
    el('aside', { class: 'cl-hero-why', 'aria-label': 'Why it matters' }, [
      el('span', { class: 'cl-hero-why-label', text: 'WHY IT MATTERS' }),
      el('p', {
        class: 'cl-hero-why-text',
        text: 'A cipher can be provably safe against the attack it was designed to resist and fall to the next one. COCONUT98 was built to defeat differential cryptanalysis and the boomerang took it anyway; Skipjack lost 31 of its 32 rounds to a difference that never happens.',
      }),
    ]),
  ]);
}

function intro(): HTMLElement {
  const def = (term: string, body: string): HTMLElement =>
    el('div', { class: 'def' }, [
      el('span', { class: 'def-term', text: term }),
      el('span', { class: 'def-body', text: body }),
    ]);
  return el('section', { class: 'card card-intro', 'aria-labelledby': 'intro-title' }, [
    el('h2', { class: 'act-title', id: 'intro-title', text: 'Three words, then the evidence' }),
    el('div', { class: 'defs' }, [
      def(
        'Difference',
        'Feed a cipher two inputs that differ in a known way and watch how their outputs differ. Attacks live in the patterns that survive.',
      ),
      def(
        'Impossible differential',
        'A pair of differences the cipher can never connect — probability exactly zero. Any candidate key that would have produced it is wrong, and gets struck out.',
      ),
      def(
        'Boomerang',
        'Split the cipher in half, find a short difference through each half, and join them with four texts instead of two: two go forward, two come back.',
      ),
    ]),
    el('p', { class: 'field-hint' }, [
      document.createTextNode(
        'Nothing here is simulated. Every rate is counted from real encryptions of the real cipher, and because the block is 256 values wide and the key space 65 536, several claims on this page can be checked by trying literally everything.',
      ),
    ]),
  ]);
}

function footer(): HTMLElement {
  return el('footer', { class: 'scripture-footer' }, [
    el('p', {
      text: 'So whether you eat or drink or whatever you do, do it all for the glory of God. — 1 Corinthians 10:31',
    }),
  ]);
}

/** Mark the chapter whose section is currently in view. */
function trackChapters(): void {
  const links = new Map<string, HTMLElement>();
  for (const c of CHAPTERS) {
    const a = document.querySelector<HTMLElement>(`.chapter-link[data-chapter="${c.id}"]`);
    if (a) links.set(c.id, a);
  }
  if (typeof IntersectionObserver !== 'function' || links.size === 0) return;
  const seen = new Map<string, number>();
  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) seen.set(e.target.id, e.intersectionRatio);
      let bestId = '';
      let best = 0;
      for (const [id, ratio] of seen) {
        if (ratio > best) {
          best = ratio;
          bestId = id;
        }
      }
      for (const [id, a] of links) {
        if (id === bestId && best > 0) a.setAttribute('aria-current', 'true');
        else a.removeAttribute('aria-current');
      }
    },
    { threshold: [0, 0.15, 0.4, 0.75] }
  );
  for (const c of CHAPTERS) {
    const section = document.getElementById(c.id);
    if (section) io.observe(section);
  }
}

function mount(): void {
  const app = document.getElementById('app');
  if (!app) throw new Error('#app is missing');

  const shared = readShareState(window.location.search);

  const sboxSelect = el('select', { id: 'global-sbox' });
  for (const n of SBOX_NAMES) sboxSelect.append(el('option', { value: n, text: SBOX_LABEL[n] }));
  sboxSelect.value = shared.sbox === 'strong' ? 'strong' : 'weak';

  const tease = teaser();
  const decay = decayPanel();
  const impossible = impossiblePanel();
  const sieve = sievePanel();
  const boomerang = boomerangPanel();
  const sw = switchPanel();
  const cipher = cipherPanel();

  impossible.restore({ alpha: shared.alpha, delta: shared.delta, rounds: shared.irounds, keys: shared.ikeys });
  sieve.restore({ alphas: shared.alphas, rounds: shared.srounds, key: shared.key });
  boomerang.restore({ keys: shared.bkeys });
  sw.restore({ case: shared.case, switchRound: shared.split });

  const shareBtn = el('button', { class: 'btn', type: 'button', id: 'share-run' }, [
    document.createTextNode('Copy a link to this run'),
  ]) as HTMLButtonElement;
  const resetBtn = el('button', { class: 'btn', type: 'button', id: 'reset-all' }, [
    document.createTextNode('Reset everything'),
  ]) as HTMLButtonElement;
  const shareOut = el('p', { class: 'announce', id: 'share-out', role: 'status', 'aria-live': 'polite' });

  const sboxName = (): SboxName => sboxSelect.value as SboxName;

  const controls = el('section', { class: 'card', 'aria-labelledby': 'global-title', id: 'controls' }, [
    el('h2', { class: 'act-title', id: 'global-title', text: 'The one control that changes everything' }),
    el('p', { class: 'act-lede' }, [
      document.createTextNode(
        `The substitution table is the only nonlinear part of this cipher, so it decides how well every attack here works. Switch it and every measurement below reruns. Round counts run to ${MAX_ROUNDS}, past the published four, because the decay only becomes the point after that.`
      ),
    ]),
    el('div', { class: 'controls' }, [
      field('Substitution table', sboxSelect, 'every act reruns on change'),
      el('div', { class: 'field' }, [
        el('span', { class: 'group-label', 'aria-hidden': 'true', text: ' ' }),
        shareBtn,
      ]),
      el('div', { class: 'field' }, [
        el('span', { class: 'group-label', 'aria-hidden': 'true', text: ' ' }),
        resetBtn,
      ]),
    ]),
    shareOut,
  ]);

  const main = el('main', {}, [
    tease.node,
    chapterNav(),
    intro(),
    decay.node,
    impossible.node,
    sieve.node,
    boomerang.node,
    sw.node,
    cipher.node,
    controls,
    contextPanel(),
    honestyPanel(),
  ]);

  app.append(hero(), main);
  document.body.append(footer());
  trackTopbarHeight();
  trackChapters();

  function runAll(): void {
    tease.render(sboxName());
    cipher.render(sboxName());
    void decay.run(sboxName());
    void impossible.run(sboxName());
    void sieve.run(sboxName());
    void boomerang.run(sboxName(), sw.currentCaseId());
    void sw.run(sboxName());
  }

  sboxSelect.addEventListener('change', runAll);

  // A case change in Act 5 changes which boomerang Act 4 is measuring, so the
  // two stay in step rather than quietly disagreeing about which trail is under
  // discussion.
  sw.onCaseChange((caseId) => {
    void boomerang.run(sboxName(), caseId);
  });

  // The teaser's one action: go to the exhibit and take the first step, so the
  // reader lands on the mechanism rather than on a heading.
  tease.onStep(() => {
    document.getElementById('act5')?.scrollIntoView({ behavior: 'auto', block: 'start' });
    sw.stepOnce();
    document.getElementById('walk-step')?.focus();
  });

  shareBtn.addEventListener('click', () => {
    const imp = impossible.state();
    const sv = sieve.state();
    const bm = boomerang.state();
    const st = sw.state();
    const url = buildShareUrl({
      sbox: sboxName(),
      alpha: imp.alpha,
      delta: imp.delta,
      irounds: imp.rounds,
      ikeys: imp.keys,
      alphas: sv.alphas,
      srounds: sv.rounds,
      key: sv.key,
      bkeys: bm.keys,
      case: st.case,
      split: st.switchRound,
    });
    // The link is always SHOWN, not only copied. A clipboard write can be
    // refused without warning, and a reader who cannot see what was copied has
    // no way to tell a silent failure from a success.
    void copyToClipboard(url).then((ok) => {
      shareOut.replaceChildren(
        document.createTextNode(
          ok
            ? 'Link copied. It carries every control and the 16-bit demo key, so the run reproduces exactly: '
            : 'Clipboard unavailable, so here is the link. It carries every control and the 16-bit demo key: '
        ),
        el('a', { href: url, id: 'share-url', class: 'share-url', text: url })
      );
    });
  });

  resetBtn.addEventListener('click', () => {
    // The S-box is passed explicitly rather than left to each panel's memory of
    // its last run: resetting from PRESENT used to leave every panel measuring
    // PRESENT under the textbook label, which the claims suite caught.
    sboxSelect.value = 'weak';
    tease.render('weak');
    cipher.render('weak');
    void decay.reset('weak');
    void impossible.reset('weak');
    void sieve.reset('weak');
    void sw.reset('weak');
    void boomerang.reset('weak', sw.currentCaseId());
    shareOut.textContent = 'Every control is back to its shipped default.';
  });

  // The arrival state is measured, not empty. A page that renders its panels and
  // waits for a press leaves five regions blank, and a blank region is what an
  // accessibility scan reports as perfectly accessible.
  runAll();
}

mount();
