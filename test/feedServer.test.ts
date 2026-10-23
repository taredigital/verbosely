import * as fs from 'fs';
import * as http from 'http';
import * as net from 'net';
import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FeedController } from '../src/core/FeedController';
import { FeedServer } from '../src/server/FeedServer';

interface Reply {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: string;
}

function request(
  port: number,
  pathAndQuery: string,
  options: {
    method?: string;
    host?: string;
    cookie?: string;
    firstChunkOnly?: boolean;
  } = {},
): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        path: pathAndQuery,
        method: options.method ?? 'GET',
        headers: {
          Host: options.host ?? `127.0.0.1:${port}`,
          ...(options.cookie ? { Cookie: options.cookie } : {}),
        },
      },
      (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk: string) => {
          body += chunk;
          // An event stream never ends; stop after the first messages.
          if (options.firstChunkOnly) {
            res.destroy();
            resolve({
              status: res.statusCode ?? 0,
              headers: res.headers,
              body,
            });
          }
        });
        res.on('end', () =>
          resolve({ status: res.statusCode ?? 0, headers: res.headers, body }),
        );
      },
    );
    req.on('error', reject);
    req.end();
  });
}

/** The path and query of a start() URL, as the browser would ask for it. */
function target(url: string): string {
  const { pathname, search } = new URL(url);
  return pathname + search;
}

/** Opens a start() URL as the browser would; returns the cookie it got. */
async function redeem(url: string): Promise<string> {
  const reply = await request(Number(new URL(url).port), target(url));
  expect(reply.status).toBe(303);
  expect(reply.headers.location).toBe('/');
  return (reply.headers['set-cookie']?.[0] ?? '').split(';')[0]!;
}

function secretOf(cookie: string): string {
  return cookie.slice(cookie.indexOf('=') + 1);
}

const cleanup: (() => void)[] = [];
afterEach(() => {
  for (const fn of cleanup.splice(0)) fn();
});

async function startServer() {
  const dist = fs.mkdtempSync(path.join(os.tmpdir(), 'verbosely-dist-'));
  fs.writeFileSync(path.join(dist, 'webview.js'), 'console.log("feed")');
  const controller = new FeedController([], os.tmpdir(), {
    initialBytes: 1024,
    maxItems: 100,
    refreshMs: 60_000,
  });
  let stopped = false;
  const server = new FeedServer(controller, dist, () => (stopped = true));
  const first = await server.start();
  const url = new URL(first);
  cleanup.push(() => {
    server.dispose();
    controller.dispose();
    fs.rmSync(dist, { recursive: true, force: true });
  });
  return {
    server,
    port: Number(url.port),
    ticket: url.searchParams.get('ticket')!,
    url,
    first,
    wasStopped: () => stopped,
  };
}

describe('FeedServer security', () => {
  it('listens on 127.0.0.1 only, with a 256-bit ticket', async () => {
    const { url, ticket } = await startServer();
    expect(url.hostname).toBe('127.0.0.1');
    expect(url.pathname).toBe('/');
    expect(ticket).toMatch(/^[0-9a-f]{64}$/);
  });

  it('trades a ticket for a strict, HttpOnly cookie named for its port', async () => {
    const { port, first, ticket } = await startServer();
    const reply = await request(port, target(first));
    expect(reply.status).toBe(303);
    expect(reply.headers.location).toBe('/');
    expect(reply.headers['cache-control']).toBe('no-store');
    expect(reply.headers['referrer-policy']).toBe('no-referrer');
    expect(reply.headers['access-control-allow-origin']).toBeUndefined();
    const cookie = reply.headers['set-cookie']?.[0] ?? '';
    expect(cookie).toMatch(
      new RegExp(
        `^verbosely-${port}=[0-9a-f]{64}; HttpOnly; SameSite=Strict; Path=/$`,
      ),
    );
    expect(cookie).not.toContain(ticket);
  });

  it('accepts a ticket only once', async () => {
    const { port, first } = await startServer();
    await redeem(first);
    expect((await request(port, target(first))).status).toBe(403);
  });

  it('refuses an expired ticket', async () => {
    const { port, first } = await startServer();
    const later = Date.now() + 61_000;
    const clock = vi.spyOn(Date, 'now').mockReturnValue(later);
    try {
      expect((await request(port, target(first))).status).toBe(403);
    } finally {
      clock.mockRestore();
    }
  });

  it('refuses a wrong ticket, or one on another path', async () => {
    const { port, ticket, first } = await startServer();
    const wrong = ticket.replace(/^./, ticket[0] === 'a' ? 'b' : 'a');
    expect((await request(port, `/?ticket=${wrong}`)).status).toBe(403);
    expect((await request(port, '/?ticket=short')).status).toBe(403);
    expect((await request(port, '/?ticket=')).status).toBe(403);
    expect((await request(port, `/events?ticket=${ticket}`)).status).toBe(403);
    expect((await request(port, `/feed.js?ticket=${ticket}`)).status).toBe(403);
    // The old token-in-the-URL scheme is gone.
    expect((await request(port, `/?t=${ticket}`)).status).toBe(403);
    // Failed tries did not use the ticket up.
    await redeem(first);
  });

  it('gives a working new ticket on every start', async () => {
    const { server, first } = await startServer();
    const second = await server.start();
    expect(second).not.toBe(first);
    expect(new URL(second).origin).toBe(new URL(first).origin);
    const cookie = await redeem(second);
    const port = Number(new URL(second).port);
    expect((await request(port, '/', { cookie })).status).toBe(200);
    // The newer ticket did not cancel the older one.
    await redeem(first);
  });

  it('rejects requests without the cookie', async () => {
    const { port } = await startServer();
    expect((await request(port, '/')).status).toBe(403);
    expect((await request(port, '/events')).status).toBe(403);
    expect((await request(port, '/feed.js')).status).toBe(403);
  });

  it('rejects a wrong cookie, including one of the right length', async () => {
    const { port, first } = await startServer();
    const cookie = await redeem(first);
    const name = `verbosely-${port}`;
    const secret = secretOf(cookie);
    const wrong = secret.replace(/^./, secret[0] === 'a' ? 'b' : 'a');
    for (const bad of [`${name}=${wrong}`, `${name}=short`, `${name}=`])
      for (const p of ['/', '/feed.js', '/events'])
        expect((await request(port, p, { cookie: bad })).status).toBe(403);
    // The secret is no key in the URL either.
    expect((await request(port, `/?t=${secret}`)).status).toBe(403);
  });

  it("refuses another port's cookie", async () => {
    const a = await startServer();
    const b = await startServer();
    const cookieA = await redeem(a.first);
    expect((await request(b.port, '/', { cookie: cookieA })).status).toBe(403);
    // Each listener has its own secret, whatever the cookie is called.
    const renamed = `verbosely-${b.port}=${secretOf(cookieA)}`;
    expect((await request(b.port, '/', { cookie: renamed })).status).toBe(403);
  });

  it('finds its cookie among others', async () => {
    const { port, first } = await startServer();
    const cookie = await redeem(first);
    const reply = await request(port, '/', {
      cookie: `other=1; verbosely-1=x; ${cookie}; last=2`,
    });
    expect(reply.status).toBe(200);
  });

  it('rejects a foreign Host header (DNS rebinding)', async () => {
    const { server, port, first } = await startServer();
    const cookie = await redeem(first);
    const fresh = await server.start();
    for (const host of [`evil.example:${port}`, `localhost:${port}`]) {
      for (const p of ['/', '/feed.js', '/events'])
        expect((await request(port, p, { host, cookie })).status).toBe(403);
      // Nor can a rebinding page redeem a ticket.
      expect((await request(port, target(fresh), { host })).status).toBe(403);
    }
    await redeem(fresh);
  });

  it('accepts only GET', async () => {
    const { server, port, first } = await startServer();
    const cookie = await redeem(first);
    const fresh = await server.start();
    for (const method of ['POST', 'PUT', 'DELETE']) {
      expect((await request(port, '/', { method, cookie })).status).toBe(403);
      expect((await request(port, target(fresh), { method })).status).toBe(403);
    }
  });

  it('serves the page with a strict policy, no CORS and no secret', async () => {
    const { port, first, ticket } = await startServer();
    const cookie = await redeem(first);
    const reply = await request(port, '/', { cookie });
    expect(reply.status).toBe(200);
    expect(reply.headers['content-security-policy']).toContain(
      "default-src 'none'",
    );
    expect(reply.headers['content-security-policy']).toContain(
      "frame-ancestors 'none'",
    );
    expect(reply.headers['referrer-policy']).toBe('no-referrer');
    expect(reply.headers['x-content-type-options']).toBe('nosniff');
    expect(reply.headers['cross-origin-resource-policy']).toBe('same-origin');
    expect(reply.headers['cache-control']).toBe('no-store');
    expect(reply.headers['access-control-allow-origin']).toBeUndefined();
    expect(reply.headers['set-cookie']).toBeUndefined();
    expect(reply.body).toContain('<script src="/feed.js"></script>');
    expect(reply.body).not.toContain(secretOf(cookie));
    expect(reply.body).not.toContain(ticket);
    expect(reply.body).not.toContain('data-token');
    expect(reply.body).not.toContain('?t=');
  });

  it('serves the script with no secret in it', async () => {
    const { port, first, ticket } = await startServer();
    const cookie = await redeem(first);
    const reply = await request(port, '/feed.js', { cookie });
    expect(reply.status).toBe(200);
    expect(reply.headers['access-control-allow-origin']).toBeUndefined();
    expect(reply.body).toBe('console.log("feed")');
    expect(reply.body).not.toContain(secretOf(cookie));
    expect(reply.body).not.toContain(ticket);
  });

  it('streams feed messages to an authorised client, with no secret', async () => {
    const { port, first, ticket } = await startServer();
    const cookie = await redeem(first);
    const reply = await request(port, '/events', {
      cookie,
      firstChunkOnly: true,
    });
    expect(reply.status).toBe(200);
    expect(reply.headers['content-type']).toBe('text/event-stream');
    expect(reply.headers['access-control-allow-origin']).toBeUndefined();
    // The stream opens by naming the folder it reports on.
    expect(reply.body).toContain('"type":"workspace"');
    expect(reply.body).not.toContain(secretOf(cookie));
    expect(reply.body).not.toContain(ticket);
  });

  it('answers a malformed request target with 400, without throwing', async () => {
    const { port } = await startServer();
    const reply = await new Promise<string>((resolve, reject) => {
      const socket = net.connect(port, '127.0.0.1', () =>
        socket.write(
          `GET http://[ HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\n\r\n`,
        ),
      );
      let data = '';
      socket.setEncoding('utf8');
      socket.on('data', (chunk: string) => {
        data += chunk;
        if (!data.includes('Bad request\r\n')) return;
        socket.destroy();
        resolve(data);
      });
      socket.on('end', () => resolve(data));
      socket.on('error', reject);
    });
    // The server's own answer (Node's parser would send no body).
    expect(reply).toMatch(/^HTTP\/1\.1 400 /);
    expect(reply).toContain('\r\nBad request\r\n');
  });

  it('shares one listener between overlapping starts', async () => {
    const { server } = await startServer();
    server.stop();
    const [first, second] = await Promise.all([server.start(), server.start()]);
    expect(new URL(first).origin).toBe(new URL(second).origin);
    expect(first).not.toBe(second);
    const port = Number(new URL(first).port);
    const cookie = await redeem(first);
    await redeem(second);
    expect((await request(port, '/', { cookie })).status).toBe(200);
    expect(new URL(await server.start()).origin).toBe(new URL(first).origin);
    // Stopping closes it: no second listener was left behind.
    server.stop();
    await expect(request(port, '/', { cookie })).rejects.toThrow();
  });

  it('forgets its tickets and cookie when restarted', async () => {
    const { server, first } = await startServer();
    const cookie = await redeem(first);
    const unused = await server.start();
    server.stop();
    const next = await server.start();
    const port = Number(new URL(next).port);
    // Whatever port the new listener got, the old keys open nothing.
    expect(
      (
        await request(port, '/', {
          cookie: `verbosely-${port}=${secretOf(cookie)}`,
        })
      ).status,
    ).toBe(403);
    const stale = new URL(unused).searchParams.get('ticket');
    expect((await request(port, `/?ticket=${stale}`)).status).toBe(403);
    await redeem(next);
  });

  it('closes the port when stopped', async () => {
    const { server, port, first, wasStopped } = await startServer();
    const cookie = await redeem(first);
    server.stop();
    expect(wasStopped()).toBe(true);
    await expect(request(port, '/', { cookie })).rejects.toThrow();
  });
});
