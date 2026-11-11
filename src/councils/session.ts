const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36';

/** A tiny browser-like session: keeps cookies and follows redirects. */
export class Session {
  private readonly cookies = new Map<string, string>();

  async send(url: string, form?: Record<string, string>): Promise<string> {
    let method = form ? 'POST' : 'GET';
    let body: string | undefined = form ? new URLSearchParams(form).toString() : undefined;
    let current = url;

    for (let hop = 0; hop < 5; hop++) {
      const headers: Record<string, string> = { 'User-Agent': USER_AGENT };
      if (this.cookies.size > 0) {
        headers.Cookie = [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
      }
      if (body !== undefined) {
        headers['Content-Type'] = 'application/x-www-form-urlencoded';
      }

      const res = await fetch(current, {
        method,
        headers,
        body,
        redirect: 'manual',
        signal: AbortSignal.timeout(30_000),
      });
      this.storeCookies(res.headers);

      if (res.status >= 300 && res.status < 400) {
        const location = res.headers.get('location');
        if (!location) {
          throw new Error(`Redirect with no location (HTTP ${res.status})`);
        }
        current = new URL(location, current).toString();
        if (res.status !== 307 && res.status !== 308) {
          method = 'GET';
          body = undefined;
        }
        continue;
      }
      if (!res.ok) {
        throw new Error(`Council site returned HTTP ${res.status}`);
      }
      return res.text();
    }
    throw new Error('Too many redirects from council site');
  }

  private storeCookies(headers: Headers): void {
    const raw = typeof headers.getSetCookie === 'function'
      ? headers.getSetCookie()
      : (headers.get('set-cookie') ? [headers.get('set-cookie') as string] : []);
    for (const cookie of raw) {
      const pair = cookie.split(';')[0];
      const eq = pair.indexOf('=');
      if (eq > 0) {
        this.cookies.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
      }
    }
  }
}
