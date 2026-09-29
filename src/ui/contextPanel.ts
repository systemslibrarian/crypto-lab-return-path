/**
 * Act 6 and the honesty panel.
 *
 * Verification gate V3: any real-cipher result named here carries its exact
 * round count from the primary paper, or it is not named. Where a data or time
 * complexity was not verified against the primary source it is OMITTED and the
 * omission is stated -- an unverified 2^78 quoted confidently is worse than no
 * number at all.
 */
import { callout, disclosure, el } from './dom.ts';

export function contextPanel(): HTMLElement {
  const section = el('section', { class: 'card', 'aria-labelledby': 'act6-title', id: 'act6' }, [
    el('div', { class: 'act-head' }, [
      el('span', { class: 'act-num', text: 'ACT 6' }),
      el('h2', { class: 'act-title', id: 'act6-title', text: 'Why anyone cares' }),
    ]),
    el('p', { class: 'act-lede' }, [
      document.createTextNode(
        'Both techniques on this page were built to beat ciphers where no single differential survives enough rounds, and both did. They are why a modern block cipher is analysed for impossible differentials and boomerangs as a matter of course, not only for classical differential probability.'
      ),
    ]),
  ]);

  section.append(
    el('ul', { class: 'refs', role: 'list' }, [
      el('li', { role: 'listitem' }, [
        el('strong', { text: 'Skipjack, 31 of its 32 rounds. ' }),
        document.createTextNode(
          'Biham, Biryukov and Shamir broke Skipjack reduced to 31 rounds using a 24-round impossible differential (EUROCRYPT 1999). At the time this was the best known attack on the cipher, and it was found by asking which differences cannot happen rather than which are likely.'
        ),
      ]),
      el('li', { role: 'listitem' }, [
        el('strong', { text: 'The name, and IDEA. ' }),
        document.createTextNode(
          'The same authors named the technique "miss in the middle" and applied it to IDEA and Khufu (FSE 1999) -- the paper that turned a trick into a method.'
        ),
      ]),
      el('li', { role: 'listitem' }, [
        el('strong', { text: 'COCONUT98, and the boomerang. ' }),
        document.createTextNode(
          'Wagner introduced the boomerang in 1999 against COCONUT98, a cipher designed to be provably secure against conventional differential cryptanalysis. It was: no single differential got through. Two halves did.'
        ),
      ]),
      el('li', { role: 'listitem' }, [
        el('strong', { text: 'AES-192 and AES-256, at full round count. ' }),
        document.createTextNode(
          'Biryukov and Khovratovich’s related-key boomerangs (ASIACRYPT 2009) reach the full AES-192 and AES-256, and the switching techniques they introduced -- the ladder switch and the S-box switch -- are what the first case in Act 5 is an instance of. These are RELATED-KEY attacks, a much stronger model than the single-key one on this page, and they do not threaten AES as deployed. This lab does not implement related-key boomerangs.'
        ),
      ]),
      el('li', { role: 'listitem' }, [
        el('strong', { text: 'And the correction. ' }),
        document.createTextNode(
          'Murphy showed in 2011 that two independently chosen trails can be incompatible, so p2q2 can be badly wrong. Cid, Huang, Peyrin, Sasaki and Song answered it in 2018 with the Boomerang Connectivity Table, which is the exact accounting for a one-layer switch -- the thing Act 5 measures.'
        ),
      ]),
    ])
  );

  section.append(
    callout('note', 'On the numbers not quoted here', [
      el('p', {}, [
        document.createTextNode(
          'Round counts above are stated because they were checked. Data and time complexities are deliberately not quoted: they were not verified against the primary papers while this page was written, and a confident 2-to-the-something is the easiest thing in cryptanalysis to get subtly wrong. Follow the references for them.'
        ),
      ]),
    ])
  );

  section.append(
    disclosure('References', [
      el('ul', { class: 'refs', role: 'list' }, [
        el('li', { role: 'listitem', text: 'E. Biham, A. Shamir. Differential Cryptanalysis of DES-like Cryptosystems. Journal of Cryptology, 1991. (The technique Act 1 measures, and the source of this toy cipher in the sibling labs.)' }),
        el('li', { role: 'listitem', text: 'L. R. Knudsen. DEAL -- A 128-bit Block Cipher. Technical report, University of Bergen, 1998. An early and independent use of impossible-differential reasoning. Not the first: Biham had already used related impossible-event reasoning on Ladder-DES, and zero entries in a difference distribution table were long known. The history in Biham-Biryukov-Shamir 1999 is the one to follow.' }),
        el('li', { role: 'listitem', text: 'E. Biham, A. Biryukov, A. Shamir. Cryptanalysis of Skipjack Reduced to 31 Rounds Using Impossible Differentials. EUROCRYPT 1999, LNCS 1592, pp. 12-23.' }),
        el('li', { role: 'listitem', text: 'E. Biham, A. Biryukov, A. Shamir. Miss in the Middle Attacks on IDEA and Khufu. FSE 1999, LNCS 1636, pp. 124-138.' }),
        el('li', { role: 'listitem', text: 'D. Wagner. The Boomerang Attack. FSE 1999, LNCS 1636, pp. 156-170. The quartet procedure and the p2q2 estimate, including its independence assumption.' }),
        el('li', { role: 'listitem', text: 'A. Biryukov, D. Khovratovich. Related-Key Cryptanalysis of the Full AES-192 and AES-256. ASIACRYPT 2009. The boomerang switch techniques, including the ladder switch and the S-box switch.' }),
        el('li', { role: 'listitem', text: 'S. Murphy. The Return of the Cryptographic Boomerang. IEEE Transactions on Information Theory 57(4), 2011, pp. 2517-2521. Independently chosen trails can be incompatible; p2q2 can be badly wrong. The problem, not the tool.' }),
        el('li', { role: 'listitem', text: 'C. Cid, T. Huang, T. Peyrin, Y. Sasaki, L. Song. Boomerang Connectivity Table: A New Cryptanalysis Tool. EUROCRYPT 2018. The round-trip table this page computes, defined for a single S-box switching layer.' }),
        el('li', { role: 'listitem', text: 'A. Bogdanov et al. PRESENT: An Ultra-Lightweight Block Cipher. CHES 2007. The source of the optional stronger S-box.' }),
      ]),
    ])
  );

  return section;
}

export function honestyPanel(): HTMLElement {
  return el('section', { class: 'card card-honest', 'aria-labelledby': 'honest-title', id: 'honesty' }, [
    el('h2', { class: 'act-title', id: 'honest-title', text: 'What is real here, and what this does not prove' }),
    el('p', {}, [
      el('strong', { text: 'Not production cryptography. ' }),
      document.createTextNode(
        'An 8-bit block with a 16-bit key is a teaching target built to be broken in front of you. Nothing on this page is a statement about a cipher anyone uses.'
      ),
    ]),
    el('ul', { class: 'honest-list', role: 'list' }, [
      el('li', { role: 'listitem' }, [
        el('strong', { text: 'Everything measured is measured. ' }),
        document.createTextNode(
          'Every probability labelled "measured" comes from real encryptions and decryptions performed in this tab, with its sample size printed beside it. Nothing is simulated, approximated, or replayed from a recording. The two tables are computed from the S-box on the page, and the test suite recomputes both by brute force along a different route.'
        ),
      ]),
      el('li', { role: 'listitem' }, [
        el('strong', { text: 'The exhaustive checks are a luxury of a tiny block. ' }),
        document.createTextNode(
          '256 plaintexts and 65 536 keys means an impossibility claim here can be checked by trying everything. For a real cipher that is out of reach, and impossibility is argued structurally -- which is what the structural argument on this page is for, and what the enumeration would catch being wrong.'
        ),
      ]),
      el('li', { role: 'listitem' }, [
        el('strong', { text: 'The impossible differential covers three rounds, not four. ' }),
        document.createTextNode(
          'On the full four-round cipher every output difference is reachable from every input difference: there is no four-round impossible differential. The attack in Act 3 uses the three-round property against the last round; it is not a distinguisher for the whole cipher.'
        ),
      ]),
      el('li', { role: 'listitem' }, [
        el('strong', { text: 'The sieve recovers 8 of 16 key bits. ' }),
        document.createTextNode(
          'A unique surviving candidate is the final mixing key, which this key schedule makes the low byte of the master key. The other byte is untouched. A recovered subkey is not a recovered key.'
        ),
      ]),
      el('li', { role: 'listitem' }, [
        el('strong', { text: 'A zero one-way entry does not bound the boomerang. ' }),
        document.createTextNode(
          'This is the negative claim this lab is built to demonstrate rather than assert. Act 2 proves a difference can never cross three rounds. Act 5 shows a crossing whose one-way table entry is zero, through which the round trip closes for all 256 middle states. Impossibility in one direction is not impossibility for a quartet, and any reasoning that treats it as such is wrong.'
        ),
      ]),
      el('li', { role: 'listitem' }, [
        el('strong', { text: 'p2q2 is an estimate, and this page shows it missing twice. ' }),
        document.createTextNode(
          'Once at the switch, where a trail reading charges for a crossing the round trip does not have to pay -- measured exactly, over all 256 middle states. And once across the two backward pairs, which the estimate multiplies as if independent and which on this cipher are not, by a factor Act 4 reports. The second effect is a property of this toy, not a general law.'
        ),
      ]),
      el('li', { role: 'listitem' }, [
        el('strong', { text: 'A one-layer switch can only help the boomerang. ' }),
        document.createTextNode(
          'The round-trip table is never below the one-way table, which the test suite proves entry by entry. So the switch cannot be what makes a boomerang RARER than p2q2 predicts. Murphy’s incompatibility, in the form where the real rate is far below the estimate, needs a middle section wider than one substitution layer -- which this page does not model and does not claim to.'
        ),
      ]),
      el('li', { role: 'listitem' }, [
        el('strong', { text: 'The boomerang needs an adaptive decryption oracle. ' }),
        document.createTextNode(
          'The shifted ciphertexts are chosen after the first pair comes back, so the attacker must be able to decrypt texts of their choosing, adaptively. That is a strong model, and rectangle and amplified-boomerang attacks exist because it is often unavailable.'
        ),
      ]),
      el('li', { role: 'listitem' }, [
        el('strong', { text: 'An end-to-end rate cannot be attributed to one trail. ' }),
        document.createTextNode(
          'Hundreds of middle paths share any pair of end differences, so a measured return rate is their total. Act 4 separates them by reading the real middle difference -- which needs the key, so it is an instrument and is labelled one -- and Act 5 avoids the problem by measuring the switch with nothing attached to it.'
        ),
      ]),
      el('li', { role: 'listitem' }, [
        el('strong', { text: 'No key material is stored. ' }),
        document.createTextNode(
          'Keys come from the platform CSPRNG, live in memory for the session, and are never written anywhere. The only thing this page persists is the string "dark".'
        ),
      ]),
      el('li', { role: 'listitem' }, [
        el('strong', { text: 'Not in scope. ' }),
        document.createTextNode(
          'Attacks on real ciphers (referenced only), related-key boomerangs, rectangle and amplified variants beyond a sentence, and automated trail search by SAT or MILP. The trails here are hand-specified and their probabilities computed from the tables.'
        ),
      ]),
    ]),
  ]);
}
