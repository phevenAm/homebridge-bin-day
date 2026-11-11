import http from 'http';
import type { Logging } from 'homebridge';
import type { BinCollection } from './councils';

interface UpcomingBin {
  type: string;
  date: string;
  daysAway: number;
}

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function toLocalDate(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
}

/** Bins from today onwards, soonest first. */
export function upcoming(bins: BinCollection[], now: Date = new Date()): UpcomingBin[] {
  const today = startOfDay(now).getTime();
  return bins
    .map(b => ({
      type: b.type,
      date: b.date,
      daysAway: Math.round((toLocalDate(b.date).getTime() - today) / 86_400_000),
    }))
    .filter(b => b.daysAway >= 0)
    .sort((a, b) => a.daysAway - b.daysAway || a.type.localeCompare(b.type));
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
export function sentence(bins: BinCollection[], now: Date = new Date()): string {
  const list = upcoming(bins, now);
  if (list.length === 0) {
    return 'I don\'t have any bin dates yet.';
  }
  const groups: UpcomingBin[][] = [];
  for (const bin of list) {
    const last = groups[groups.length - 1];
    if (last && last[0].date === bin.date) {
      last.push(bin);
    } else {
      groups.push([bin]);
    }
  }
  const first = groups[0];
  let text = `Next is ${joinNames(first.map(b => b.type))}, ${whenText(first[0].date, first[0].daysAway)}.`;
  const second = groups[1];
  if (second) {
    text += ` Then ${joinNames(second.map(b => b.type))}, ${whenText(second[0].date, second[0].daysAway)}.`;
  }
  return text;
}

/**
 * Small read-only web server for Siri Shortcuts.
 *   /next  -> a sentence to speak
 *   /bins  -> JSON list of upcoming bins
 */
export function startHttpServer(port: number, log: Logging, getBins: () => BinCollection[]): void {
  const server = http.createServer((req, res) => {
    const path = (req.url ?? '/').split('?')[0];
    if (req.method !== 'GET') {
      res.writeHead(405).end();
      return;
    }
    if (path === '/next' || path === '/') {
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end(sentence(getBins()));
      return;
    }
    if (path === '/bins') {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(upcoming(getBins()), null, 2));
      return;
    }
    res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found');
  });
  server.on('error', err => {
    log.error(`Couldn't start the Shortcuts web link on port ${port}: ${err.message}`);
  });
  server.listen(port, () => {
    log.info(`Shortcuts link ready: http://<your-pi>:${port}/next`);
  });
}
