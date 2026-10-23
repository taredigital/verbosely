import * as crypto from 'crypto';
import * as fs from 'fs';
import * as http from 'http';
import type { AddressInfo } from 'net';
import * as path from 'path';
import type { FeedController } from '../core/FeedController';
import { streamFeed, type FeedExtras } from '../core/feedStream';
import type { HostMessage } from '../shared/protocol';

const IDLE_SHUTDOWN_MS = 30_000;
const HEARTBEAT_MS = 15_000;
const TICKET_MS = 60_000;

/**
 * Serves the feed to a browser tab so it can float in the browser's
 * picture-in-picture window, which stays visible with VS Code minimised.
 *
 * Locked down because it is a network listener:
 * - started only on request, bound to 127.0.0.1 on a random port
 * - the URL handed to the browser holds a one-time ticket, valid for a
 *   minute; redeeming it sets an HttpOnly cookie with a random 256-bit
 *   secret, so no key stays in the browser's history or on screen
 * - every other request needs that cookie
 * - the Host header must be exactly 127.0.0.1:<port> (blocks DNS rebinding)
 * - GET only and read-only: the page can watch, never change anything
 * - no CORS headers, so other sites cannot read responses
 * - shuts down when the last tab has been closed for a while
 */
export class FeedServer {
  /** The cookie's value; new for every listener. */
  private secret = randomKey();
  /** Unredeemed tickets and when each expires. */
  private readonly tickets = new Map<string, number>();
  private readonly clients = new Set<http.ServerResponse>();
  private server?: http.Server;
  private listening?: Promise<void>;
  private port = 0;
  private idleTimer?: ReturnType<typeof setTimeout>;

  constructor(
    private readonly controller: FeedController,
    private readonly distDir: string,
    private readonly onStopped: () => void,
    /** Bookmarks, notes and options; the page shows them, read-only. */
    private readonly extras: FeedExtras = {},
  ) {}

  /**
   * Starts listening if needed and returns the page URL, with a fresh
   * one-time ticket (each "Open in Browser" gets its own).
   */
  async start(): Promise<string> {
    // Shared, so two quick calls get one listener (and one port).
    this.listening ??= this.listen();
    await this.listening;
    const now = Date.now();
    for (const [ticket, expires] of this.tickets)
      if (expires <= now) this.tickets.delete(ticket);
    const ticket = randomKey();
    this.tickets.set(ticket, now + TICKET_MS);
    return `http://127.0.0.1:${this.port}/?ticket=${ticket}`;
  }

  private async listen(): Promise<void> {
    this.secret = randomKey();
    const server = http.createServer((req, res) => this.handle(req, res));
    this.server = server;
    try {
      await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', () => resolve());
      });
    } catch (err) {
      if (this.server === server) {
        this.server = undefined;
        this.listening = undefined;
      }
      throw err;
    }
    // Stopped while it was starting.
    if (this.server !== server) {
      server.close();
      return;
    }
    this.port = (server.address() as AddressInfo).port;
    this.armIdleTimer();
  }

  private handle(req: http.IncomingMessage, res: http.ServerResponse): void {
    let url: URL;
    try {
      url = new URL(req.url ?? '/', `http://127.0.0.1:${this.port}`);
    } catch {
      // A malformed request target; never let it throw in the host.
      res.writeHead(400, { 'Content-Type': 'text/plain' }).end('Bad request');
      return;
    }
    const forbid = () =>
      res.writeHead(403, { 'Content-Type': 'text/plain' }).end('Forbidden');
    if (req.method !== 'GET' || req.headers.host !== `127.0.0.1:${this.port}`)
      return void forbid();
    // The first visit trades its ticket for the cookie, then reloads without
    // it, so the address bar and history keep a plain URL.
    const ticket = url.searchParams.get('ticket');
    if (ticket !== null) {
      if (url.pathname !== '/' || !this.redeem(ticket)) return void forbid();
      res
        .writeHead(303, {
          ...this.headers('text/plain'),
          Location: '/',
          'Set-Cookie': `${this.cookieName}=${this.secret}; HttpOnly; SameSite=Strict; Path=/`,
        })
        .end();
      return;
    }
    if (!this.validCookie(req.headers.cookie)) return void forbid();
    switch (url.pathname) {
      case '/':
        return this.send(res, 'text/html; charset=utf-8', this.page());
      case '/feed.js':
        return this.sendFile(res, 'application/javascript; charset=utf-8');
      case '/events':
        return this.stream(req, res);
      default:
        res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found');
    }
  }

  /** Cookies are shared by every port on a host, so the name has the port. */
  private get cookieName(): string {
    return `verbosely-${this.port}`;
  }

  /** Uses up a ticket; true if it was live. */
  private redeem(candidate: string): boolean {
    const now = Date.now();
    for (const [ticket, expires] of this.tickets) {
      if (!sameKey(candidate, ticket)) continue;
      this.tickets.delete(ticket);
      return expires > now;
    }
    return false;
  }

  private validCookie(header: string | undefined): boolean {
    const prefix = `${this.cookieName}=`;
    return (header ?? '')
      .split(';')
      .map((part) => part.trim())
      .some(
        (part) =>
          part.startsWith(prefix) &&
          sameKey(part.slice(prefix.length), this.secret),
      );
  }

  private headers(contentType: string): http.OutgoingHttpHeaders {
    return {
      'Content-Type': contentType,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      // Other sites may not even embed the responses.
      'Cross-Origin-Resource-Policy': 'same-origin',
      // The first URL holds a ticket; never pass a URL on to other sites.
      'Referrer-Policy': 'no-referrer',
      'Content-Security-Policy': [
        `default-src 'none'`,
        `script-src 'self'`,
        `style-src 'unsafe-inline'`,
        `connect-src 'self'`,
        `img-src 'self' data:`,
        `frame-ancestors 'none'`,
      ].join('; '),
    };
  }

  private send(res: http.ServerResponse, type: string, body: string): void {
    res.writeHead(200, this.headers(type)).end(body);
  }

  private sendFile(res: http.ServerResponse, type: string): void {
    fs.readFile(path.join(this.distDir, 'webview.js'), (err, data) => {
      if (err) {
        res.writeHead(500, { 'Content-Type': 'text/plain' }).end('Missing');
        return;
      }
      res.writeHead(200, this.headers(type)).end(data);
    });
  }

  private page(): string {
    return `<!DOCTYPE html>
<html lang="en" data-mode="browser">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Verbosely</title>
</head>
<body data-mode="browser">
  <div id="root"></div>
  <script src="/feed.js"></script>
</body>
</html>`;
  }

  /** Server-Sent Events: the same messages the VS Code webviews receive. */
  private stream(req: http.IncomingMessage, res: http.ServerResponse): void {
    res.writeHead(200, {
      ...this.headers('text/event-stream'),
      Connection: 'keep-alive',
    });
    const send = (message: HostMessage) =>
      res.write(`data: ${JSON.stringify(message)}\n\n`);
    send({ type: 'workspace', path: this.controller.workspace ?? '' });
    const subscription = streamFeed(this.controller, this.extras, send);
    const heartbeat = setInterval(() => res.write(': ping\n\n'), HEARTBEAT_MS);
    this.clients.add(res);
    this.clearIdleTimer();

    req.on('close', () => {
      clearInterval(heartbeat);
      subscription.dispose();
      this.clients.delete(res);
      if (!this.clients.size) this.armIdleTimer();
    });
  }

  private armIdleTimer(): void {
    this.clearIdleTimer();
    this.idleTimer = setTimeout(() => this.stop(), IDLE_SHUTDOWN_MS);
  }

  private clearIdleTimer(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = undefined;
  }

  get running(): boolean {
    return this.server !== undefined;
  }

  stop(): void {
    this.clearIdleTimer();
    for (const res of this.clients) res.end();
    this.clients.clear();
    this.tickets.clear();
    this.server?.close();
    this.listening = undefined;
    if (this.server) {
      this.server = undefined;
      this.onStopped();
    }
  }

  dispose(): void {
    this.stop();
  }
}

function randomKey(): string {
  return crypto.randomBytes(32).toString('hex');
}

/** Compares in constant time, so the answer's timing gives nothing away. */
function sameKey(candidate: string, key: string): boolean {
  const a = Buffer.from(candidate);
  const b = Buffer.from(key);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
