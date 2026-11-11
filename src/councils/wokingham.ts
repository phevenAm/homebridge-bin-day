// Based on the Wokingham parser from UKBinCollectionData (MIT):
// https://github.com/robbrad/UKBinCollectionData
import { parse, HTMLElement } from 'node-html-parser';
import { Session } from './session';
import type { BinCollection, CouncilResult } from './types';

export const WOKINGHAM_URL =
  'https://www.wokingham.gov.uk/rubbish-and-recycling/waste-collection/find-your-bin-collection-day';

const FORM = 'form#waste-collection-api-form';

function formValue(root: HTMLElement, name: string): string {
  const value = root.querySelector(`${FORM} input[name="${name}"]`)?.getAttribute('value');
  if (!value) {
    throw new Error(`Council page layout has changed (missing ${name})`);
  }
  return value;
}

export async function fetchWokingham(
  postcode: string,
  houseNumber: string,
  url: string = WOKINGHAM_URL,
): Promise<CouncilResult> {
  const session = new Session();

  // Step 1: load the page to get the form tokens.
  const page1 = parse(await session.send(url));
  if (!page1.querySelector(FORM)) {
    throw new Error('Could not find the bin search form on the council page');
  }
  const formId = formValue(page1, 'form_id');

  // Step 2: search the postcode to get the address list.
  const page2 = parse(await session.send(url, {
    postcode_search: postcode,
    form_build_id: formValue(page1, 'form_build_id'),
    form_id: formId,
    op: 'Find address',
  }));
  const options = page2.querySelectorAll('select#edit-address-options option')
    .filter(opt => {
      const value = opt.getAttribute('value') ?? '';
      return value !== '' && value !== '0';
    });
  if (options.length === 0) {
    throw new Error(`No addresses found for postcode ${postcode}`);
  }

  const wanted = houseNumber.trim().toUpperCase();
  const match = options.find(opt => {
    const text = opt.text.trim().toUpperCase();
    return text.startsWith(`${wanted},`) || text.startsWith(`${wanted} `);
  });
  if (!match) {
    throw new Error(`Could not find "${houseNumber}" in the addresses for ${postcode}`);
  }

  // Step 3: pick the address to get the collection dates.
  const page3 = parse(await session.send(url, {
    postcode_search: postcode,
    address_options: match.getAttribute('value') as string,
    form_build_id: formValue(page2, 'form_build_id'),
    form_id: formId,
    op: 'Show collection dates',
  }));

  return { address: match.text.trim(), bins: parseCards(page3) };
}

export function parseCards(root: HTMLElement, today: Date = new Date()): BinCollection[] {
  const found = new Map<string, string>();
  for (const card of root.querySelectorAll('div.card')) {
    const type = card.querySelector('h3')?.text.trim();
    const dateText = card.querySelector('span.card__date')?.text.trim();
    if (!type || !dateText) {
      continue;
    }
    // Looks like "Tuesday 09/06/2026" or "Today 02/06/2026".
    const m = dateText.match(/(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?/);
    if (!m) {
      continue;
    }
    const day = Number(m[1]);
    const month = Number(m[2]);
    let year = m[3] ? Number(m[3]) : today.getFullYear();
    if (!m[3]) {
      const candidate = new Date(year, month - 1, day);
      const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
      if (candidate < startOfToday) {
        year += 1;
      }
    }
    const iso = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const existing = found.get(type);
    if (!existing || iso < existing) {
      found.set(type, iso);
    }
  }
  return [...found].map(([type, date]) => ({ type, date }));
}
