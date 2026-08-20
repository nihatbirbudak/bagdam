// Testler için minimal çerez kavanozu — Node fetch çerez tutmaz. Set-Cookie'leri ad+yol ile saklar,
// istek yoluna göre (path öneki) `Cookie` başlığı üretir; Max-Age=0 / geçmiş Expires silme sayılır.

export interface StoredCookie {
  name: string;
  value: string;
  path: string;
  /** Ham Set-Cookie satırı (öznitelik doğrulamaları için). */
  raw: string;
}

export interface ParsedSetCookie extends StoredCookie {
  httpOnly: boolean;
  secure: boolean;
  sameSite: string | null;
  maxAge: number | null;
  expires: Date | null;
}

export function parseSetCookie(raw: string): ParsedSetCookie {
  const [pair, ...attrParts] = raw.split(';');
  const eq = pair.indexOf('=');
  const name = pair.slice(0, eq).trim();
  const value = decodeURIComponent(pair.slice(eq + 1).trim());
  let path = '/';
  let httpOnly = false;
  let secure = false;
  let sameSite: string | null = null;
  let maxAge: number | null = null;
  let expires: Date | null = null;
  for (const part of attrParts) {
    const trimmed = part.trim();
    const [attrName, ...rest] = trimmed.split('=');
    const key = attrName.trim().toLowerCase();
    const val = rest.join('=').trim();
    if (key === 'path') path = val || '/';
    else if (key === 'httponly') httpOnly = true;
    else if (key === 'secure') secure = true;
    else if (key === 'samesite') sameSite = val;
    else if (key === 'max-age') maxAge = Number(val);
    else if (key === 'expires') expires = new Date(val);
  }
  return { name, value, path, raw, httpOnly, secure, sameSite, maxAge, expires };
}

export class CookieJar {
  private readonly store = new Map<string, StoredCookie>();

  /** Yanıttaki tüm Set-Cookie'leri işler; silinen çerezleri kavanozdan düşürür. */
  absorb(res: Response): ParsedSetCookie[] {
    const parsed = res.headers.getSetCookie().map(parseSetCookie);
    for (const c of parsed) {
      const key = `${c.name}@${c.path}`;
      const expired = (c.maxAge !== null && c.maxAge <= 0) || (c.expires !== null && c.expires.getTime() <= Date.now());
      if (expired || c.value === '') this.store.delete(key);
      else this.store.set(key, { name: c.name, value: c.value, path: c.path, raw: c.raw });
    }
    return parsed;
  }

  /** İstek yoluna gidecek `Cookie` başlığı (path öneki eşleşenler). */
  header(requestPath: string): string {
    const parts: string[] = [];
    for (const c of this.store.values()) {
      if (requestPath === c.path || requestPath.startsWith(c.path.endsWith('/') ? c.path : `${c.path}/`)) {
        parts.push(`${c.name}=${c.value}`);
      }
    }
    return parts.join('; ');
  }

  get(name: string): StoredCookie | undefined {
    for (const c of this.store.values()) if (c.name === name) return c;
    return undefined;
  }

  has(name: string): boolean {
    return this.get(name) !== undefined;
  }

  set(name: string, value: string, path = '/'): void {
    this.store.set(`${name}@${path}`, { name, value, path, raw: '' });
  }

  delete(name: string): void {
    for (const key of [...this.store.keys()]) if (key.startsWith(`${name}@`)) this.store.delete(key);
  }

  clear(): void {
    this.store.clear();
  }
}
