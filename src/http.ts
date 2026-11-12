import http from 'http';
import type { Logging } from 'homebridge';
import type { BinCollection } from './councils';
import { isAlertActive } from './schedule';

/** Everything the web API needs from the platform. */
export interface ApiState {
  version: string;
  council: string;
  address?: string;
  bins: BinCollection[];
  alertTime: [number, number];
  endTime: [number, number];
  colours: Record<string, string>;
  lastAttempt?: string;
  lastSuccess?: string;
  lastError?: string;
}

export interface UpcomingBin {
  id: string;
  type: string;
  date: string;
  dayName: string;
  daysAway: number;
  outTonight: boolean;
  colour?: string;
}

const DAY_MS = 86_400_000;

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function toLocalDate(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
}

/** "Food waste" -> "food-waste" */
export function binId(type: string): string {
  return type.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function colourFor(type: string, colours: Record<string, string>): string | undefined {
  const wanted = type.toLowerCase();
  for (const [name, colour] of Object.entries(colours)) {
    if (name.toLowerCase() === wanted) {
      return colour;
    }
  }
  return undefined;
}

/** Bins from today onwards, soonest first. */
export function upcoming(state: Pick<ApiState, 'bins' | 'alertTime' | 'endTime' | 'colours'>, now: Date = new Date()): UpcomingBin[] {
  const today = startOfDay(now).getTime();
  return state.bins
    .map(b => ({
      id: binId(b.type),
      type: b.type,
      date: b.date,
      dayName: toLocalDate(b.date).toLocaleDateString('en-GB', { weekday: 'long' }),
      daysAway: Math.round((toLocalDate(b.date).getTime() - today) / DAY_MS),
      outTonight: isAlertActive(b.date, now, state.alertTime, state.endTime),
      colour: colourFor(b.type, state.colours),
    }))
    .filter(b => b.daysAway >= 0)
    .sort((a, b) => a.daysAway - b.daysAway || a.type.localeCompare(b.type));
}

/** The soonest collection day, which may have more than one bin. */
export function nextGroup(list: UpcomingBin[]): UpcomingBin[] {
  return list.length === 0 ? [] : list.filter(b => b.date === list[0].date);
}

function joinNames(names: string[]): string {
  if (names.length <= 1) {
    return names.join('');
  }
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

function whenText(iso: string, daysAway: number): string {
  const nice = toLocalDate(iso).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
  if (daysAway === 0) {
    return `today, ${nice}`;
  }
  if (daysAway === 1) {
    return `tomorrow, ${nice}`;
  }
  return nice;
}

/** A short sentence for Siri, e.g. "Next is Recycling and Food waste, tomorrow, Tuesday 17 November." */
export function sentence(list: UpcomingBin[]): string {
  if (list.length === 0) {
    return 'I don\'t have any bin dates yet.';
  }
  const first = nextGroup(list);
  let text = `Next is ${joinNames(first.map(b => b.type))}, ${whenText(first[0].date, first[0].daysAway)}.`;
  const rest = list.filter(b => b.date !== first[0].date);
  const second = nextGroup(rest);
  if (second.length > 0) {
    text += ` Then ${joinNames(second.map(b => b.type))}, ${whenText(second[0].date, second[0].daysAway)}.`;
  }
  return text;
}

function icsEscape(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
}

function icsDate(d: Date): string {
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
}

/** Calendar feed: one all-day event per upcoming collection, with a reminder at alertTime the day before. */
export function calendar(list: UpcomingBin[], alertTime: [number, number], now: Date = new Date()): string {
  const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const minutesBefore = 24 * 60 - (alertTime[0] * 60 + alertTime[1]);
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//homebridge-bin-day//EN',
    'CALSCALE:GREGORIAN',
    'X-WR-CALNAME:Bin Day',
    'REFRESH-INTERVAL;VALUE=DURATION:PT12H',
    'X-PUBLISHED-TTL:PT12H',
  ];
  for (const bin of list) {
    const start = toLocalDate(bin.date);
    const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 1);
    lines.push(
      'BEGIN:VEVENT',
      `UID:${bin.id}-${bin.date}@homebridge-bin-day`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${icsDate(start)}`,
      `DTEND;VALUE=DATE:${icsDate(end)}`,
      `SUMMARY:${icsEscape(`${bin.type} collection`)}`,
      'TRANSP:TRANSPARENT',
      'BEGIN:VALARM',
      'ACTION:DISPLAY',
      `DESCRIPTION:${icsEscape(`Put the ${bin.type} out tonight`)}`,
      `TRIGGER:-PT${minutesBefore}M`,
      'END:VALARM',
      'END:VEVENT',
    );
  }
  lines.push('END:VCALENDAR');
  return lines.join('\r\n') + '\r\n';
}

const LINKS = {
  '/api': 'This list',
  '/api/bins': 'All upcoming bins (JSON)',
  '/api/bins/next': 'The next collection (JSON)',
  '/api/bins/next.txt': 'The next collection as a sentence, for Siri',
  '/api/bins/{id}': 'One bin, e.g. /api/bins/recycling (JSON)',
  '/api/bins.ics': 'Calendar feed for Apple or Google Calendar',
  '/api/status': 'Plugin health: last check, errors, version (JSON)',
};

/**
 * Small read-only web API on the home network.
 * Old links /next and /bins still work.
 */
export function startHttpServer(port: number, apiKey: string | undefined, log: Logging, getState: () => ApiState): void {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const path = url.pathname.replace(/\/+$/, '') || '/';

    const send = (status: number, type: string, body: string): void => {
      res.writeHead(status, {
        'Content-Type': `${type}; charset=utf-8`,
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'X-API-Key, Authorization',
        'Cache-Control': 'no-cache',
      });
      res.end(body);
    };
    const json = (status: number, data: unknown): void => send(status, 'application/json', JSON.stringify(data, null, 2));

    if (req.method === 'OPTIONS') {
      send(204, 'text/plain', '');
      return;
    }
    if (req.method !== 'GET') {
      json(405, { error: 'Only GET is supported' });
      return;
    }

    if (apiKey) {
      const given = url.searchParams.get('key')
        ?? (req.headers['x-api-key'] as string | undefined)
        ?? (req.headers.authorization ?? '').replace(/^Bearer\s+/i, '');
      if (given !== apiKey) {
        json(401, { error: 'Missing or wrong key. Add ?key=YOUR_KEY to the link.' });
        return;
      }
    }

    const state = getState();
    const list = upcoming(state);

    switch (path) {
      case '/':
      case '/api':
        json(200, { name: 'Bin Day', version: state.version, links: LINKS });
        return;
      case '/next':
      case '/api/bins/next.txt':
        send(200, 'text/plain', sentence(list));
        return;
      case '/bins':
        // Old link: kept as a plain list so anything already using it keeps working.
        json(200, list);
        return;
      case '/api/bins':
        json(200, { address: state.address ?? null, updated: state.lastSuccess ?? null, bins: list });
        return;
      case '/api/bins/next': {
        const group = nextGroup(list);
        json(200, {
          date: group[0]?.date ?? null,
          dayName: group[0]?.dayName ?? null,
          daysAway: group[0]?.daysAway ?? null,
          outTonight: group.some(b => b.outTonight),
          bins: group,
          sentence: sentence(list),
        });
        return;
      }
      case '/api/bins.ics':
        send(200, 'text/calendar', calendar(list, state.alertTime));
        return;
      case '/api/status':
        json(200, {
          version: state.version,
          council: state.council,
          address: state.address ?? null,
          binCount: state.bins.length,
          lastAttempt: state.lastAttempt ?? null,
          lastSuccess: state.lastSuccess ?? null,
          lastError: state.lastError ?? null,
          ok: Boolean(state.lastSuccess) && !state.lastError,
        });
        return;
    }

    const one = path.match(/^\/api\/bins\/([a-z0-9-]+)$/);
    if (one) {
      const bin = list.find(b => b.id === one[1]);
      if (bin) {
        json(200, bin);
      } else {
        json(404, { error: `No bin called "${one[1]}"`, available: list.map(b => b.id) });
      }
      return;
    }

    json(404, { error: 'Not found. See /api for the list of links.' });
  });

  server.on('error', err => {
    log.error(`Couldn't start the web API on port ${port}: ${err.message}`);
  });
  server.listen(port, () => {
    log.info(`Web API ready on port ${port}. Try http://<your-pi>:${port}/api`);
  });
}
