/**
 * DDT and BCT rendered as tables, for the expert disclosures.
 *
 * The cell under discussion is outlined AND bolded AND given a visible
 * `data-picked` marker, never highlighted by colour alone. Both tables scroll
 * sideways on a phone, so each is inside a labelled, focusable region.
 */
import { el, hex4, scrollRegion } from './dom.ts';
import { NIBBLE_VALUES, type Table } from '../crypto/tables.ts';

export interface Pick {
  readonly row: number;
  readonly col: number;
  readonly tone: 'ok' | 'bad';
}

export function tableView(
  table: Table,
  caption: string,
  label: string,
  picks: readonly Pick[] = [],
  hotThreshold = Infinity
): HTMLElement {
  const thead = el('thead', {}, [
    el('tr', {}, [
      el('th', { scope: 'col', text: '' }),
      ...Array.from({ length: NIBBLE_VALUES }, (_, c) => el('th', { scope: 'col', text: hex4(c) })),
    ]),
  ]);
  const rows: HTMLElement[] = [];
  for (let r = 0; r < NIBBLE_VALUES; r++) {
    const cells: HTMLElement[] = [el('th', { scope: 'row', text: hex4(r) })];
    for (let c = 0; c < NIBBLE_VALUES; c++) {
      const v = table[r][c];
      const pick = picks.find((p) => p.row === r && p.col === c);
      const classes = [
        v === 0 ? 'zero' : '',
        v >= hotThreshold ? 'hot' : '',
        pick ? (pick.tone === 'ok' ? 'picked' : 'picked-bad') : '',
      ]
        .filter(Boolean)
        .join(' ');
      const td = el('td', { class: classes || undefined, text: String(v) });
      if (pick) td.setAttribute('data-picked', pick.tone);
      cells.push(td);
    }
    rows.push(el('tr', {}, cells));
  }
  const tbl = el('table', {}, [el('caption', { text: caption }), thead, el('tbody', {}, rows)]);
  return scrollRegion(label, 'table-wrap', [tbl]);
}
