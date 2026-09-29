/**
 * Return Path -- impossible differentials and the boomerang attack, against the
 * toy SPN of crypto-lab-biham-lens and crypto-lab-matsui-line.
 *
 * The page is one storyline, top to bottom: the ordinary trail dies, an event
 * that cannot happen turns up, keys fall, the boomerang comes back, and the
 * round-trip table explains why the estimate missed. Depth lives in disclosures
 * inside each act rather than behind a mode, so nothing a reader might want is
 * gated and nothing they do not want is in the way.
 */
import './style.css';
import { SBOX_LABEL, SBOX_NAMES, type SboxName } from './crypto/sbox.ts';
import { BLOCK_SIZE, MAX_ROUNDS } from './crypto/spn.ts';
import { MASTER_KEY_SPACE } from './crypto/experiments.ts';
import { el, field, num } from './ui/dom.ts';
import { cipherPanel } from './ui/cipherPanel.ts';
import { decayPanel } from './ui/decayPanel.ts';
import { impossiblePanel } from './ui/impossiblePanel.ts';
import { sievePanel } from './ui/sievePanel.ts';
import { boomerangPanel } from './ui/boomerangPanel.ts';
import { switchPanel } from './ui/switchPanel.ts';
import { contextPanel, honestyPanel } from './ui/contextPanel.ts';

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
        text: 'Watch the best differential trail through a toy cipher decay past usefulness, then break the same cipher two other ways: with a difference whose probability is exactly zero, and with a quartet of texts that leaves by one path and comes back by another.',
      }),
    ]),
    el('aside', { class: 'cl-hero-why', 'aria-label': 'Why it matters' }, [
      el('span', { class: 'cl-hero-why-label', text: 'WHY IT MATTERS' }),
      el('p', {
        class: 'cl-hero-why-text',
        text: 'A cipher can be provably safe against the attack it was designed to resist and fall to the next one. COCONUT98 was built to defeat differential cryptanalysis and the boomerang took it anyway; Skipjack lost 31 of its 32 rounds to a difference that never happens. Security against one technique is not security.',
      }),
    ]),
  ]);
}

function intro(): HTMLElement {
  return el('section', { class: 'card card-intro', 'aria-labelledby': 'intro-title' }, [
    el('h2', { class: 'act-title', id: 'intro-title', text: 'What this is' }),
    el('p', {}, [
      document.createTextNode(
        'A block cipher scrambles a block of bits in several rounds. One way to attack it is to stop caring about the actual values and watch a '
      ),
      el('strong', { text: 'difference' }),
      document.createTextNode(
        ': feed in two inputs that differ in a known way, and see whether their outputs differ in a predictable way. If some difference survives the whole cipher often enough, you can pick out the key. That attack is differential cryptanalysis, and it is what '
      ),
      el('a', {
        href: 'https://systemslibrarian.github.io/crypto-lab-biham-lens/',
        target: '_blank',
        rel: 'noopener',
        text: 'Biham Lens',
      }),
      document.createTextNode(' does to this same cipher.'),
    ]),
    el('p', {}, [
      document.createTextNode(
        'Add rounds and it stops working: no single difference survives often enough to count. Two ideas from 1999 get past that. '
      ),
      el('strong', { text: 'An impossible differential' }),
      document.createTextNode(
        ' gives up on likely differences and looks for one with probability exactly zero -- then throws away every candidate key that would have produced it. '
      ),
      el('strong', { text: 'A boomerang' }),
      document.createTextNode(
        ' splits the cipher in half, finds a short difference through each half, and joins them with four texts instead of two: two go forward, two come back, and the difference you started with reappears at the end.'
      ),
    ]),
    el('p', {}, [
      document.createTextNode(
        'The interesting part is where the boomerang’s standard estimate goes wrong. It assumes the two halves do not interfere at the substitution layer where they meet. They do -- and the direction of the error is the surprise: a crossing that is '
      ),
      el('strong', { text: 'flatly impossible' }),
      document.createTextNode(
        ' one way can let the round trip through every single time. There is a table for that, published in 2018, and this page computes it from the S-box and measures against it.'
      ),
    ]),
    el('p', { class: 'field-hint' }, [
      document.createTextNode(
        `Nothing here is simulated. Every rate is counted from real encryptions of the real cipher, and because the block is ${BLOCK_SIZE} values wide and the key space is ${num(MASTER_KEY_SPACE)}, several claims on this page can be checked by trying literally everything.`
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

function mount(): void {
  const app = document.getElementById('app');
  if (!app) throw new Error('#app is missing');

  const sboxSelect = el('select', { id: 'global-sbox' });
  for (const n of SBOX_NAMES) {
    sboxSelect.append(el('option', { value: n, text: SBOX_LABEL[n] }));
  }
  sboxSelect.value = 'weak';

  const decay = decayPanel();
  const impossible = impossiblePanel();
  const sieve = sievePanel();
  const boomerang = boomerangPanel();
  const sw = switchPanel();

  const main = el('main', {}, [
    intro(),
    el('section', { class: 'card', 'aria-labelledby': 'global-title' }, [
      el('h2', { class: 'act-title', id: 'global-title', text: 'The one control that changes everything' }),
      el('p', { class: 'act-lede' }, [
        document.createTextNode(
          `The substitution table is the only nonlinear part of this cipher, so it decides how well every attack on this page works. The textbook table has a difference that holds half the time; the PRESENT table’s best is a quarter. Switch it and every measurement below reruns. Round counts run to ${MAX_ROUNDS}, past the published four, because the decay only becomes the point after that.`
        ),
      ]),
      el('div', { class: 'controls' }, [
        field('Substitution table', sboxSelect, 'every act below reruns on change'),
      ]),
    ]),
    cipherPanel(),
    decay.node,
    impossible.node,
    sieve.node,
    boomerang.node,
    sw.node,
    contextPanel(),
    honestyPanel(),
  ]);

  app.append(hero(), main);
  document.body.append(footer());

  const sboxName = (): SboxName => sboxSelect.value as SboxName;

  sboxSelect.addEventListener('change', () => {
    void decay.run(sboxName());
    void impossible.run(sboxName());
    void sieve.run(sboxName());
    void boomerang.run(sboxName(), sw.currentCaseId());
    void sw.run(sboxName());
  });

  // A case change in Act 5 changes which boomerang Act 4 is measuring, so the
  // two stay in step rather than quietly disagreeing about which trail is under
  // discussion.
  sw.onCaseChange((caseId) => {
    void boomerang.run(sboxName(), caseId);
  });

  // The arrival state is measured, not empty. A page that renders its panels and
  // waits for a press leaves five regions blank, and a blank region is what an
  // accessibility scan reports as perfectly accessible.
  void decay.run(sboxName());
  void impossible.run(sboxName());
  void sieve.run(sboxName());
  void boomerang.run(sboxName(), sw.currentCaseId());
  void sw.run(sboxName());
}

mount();
