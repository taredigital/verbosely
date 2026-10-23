import * as fs from 'fs';

/** The most one pass reads; anything more is read in the passes after it. */
const MAX_READ_BYTES = 8 * 1024 * 1024;
/** A line still unfinished past this is no log record: it is dropped. */
const MAX_LINE_BYTES = 32 * 1024 * 1024;

export interface TailerOptions {
  /** On start, only read this many bytes from the end of the file. */
  initialBytes: number;
  /** Fallback poll interval; fs.watch can miss events on some file systems. */
  pollMs?: number;
  /** Overrides MAX_READ_BYTES (tests). */
  maxReadBytes?: number;
  /** Overrides MAX_LINE_BYTES (tests). */
  maxLineBytes?: number;
}

/**
 * Follows an append-only JSONL file and emits each complete line once.
 *
 * Reads only the bytes added since the last read and keeps any trailing
 * partial line until its newline arrives. Splitting happens on raw bytes so a
 * multi-byte character cut across two reads is never decoded half-way.
 * Memory stays bounded: reads come in chunks, and a line that never ends is
 * dropped rather than held. A file that vanishes or is locked mid-read is
 * simply tried again on the next poll.
 */
export class JsonlTailer {
  private offset = 0;
  private remainder: Buffer = Buffer.alloc(0);
  private watcher?: fs.FSWatcher;
  private timer?: ReturnType<typeof setInterval>;
  private reading = false;
  private pending = false;
  private disposed = false;
  /** Set when starting mid-file: the first line read is incomplete. */
  private skipFirstLine = false;
  /** True when the start of the file was skipped to respect initialBytes. */
  trimmed = false;
  /** Identity of the file read so far, to notice it being replaced. */
  private identity?: string;

  constructor(
    readonly file: string,
    private readonly onLines: (lines: string[]) => void,
    private readonly options: TailerOptions,
  ) {}

  start(): void {
    let size = 0;
    try {
      const stat = fs.statSync(this.file);
      size = stat.size;
      this.identity = identityOf(stat);
    } catch {
      // The file may not exist yet; polling picks it up once it does.
    }
    if (size > this.options.initialBytes) {
      this.offset = size - this.options.initialBytes;
      // Unless the cut lands just after a newline, the first line read is
      // the tail of a record.
      this.skipFirstLine = !followsNewline(this.file, this.offset);
      this.trimmed = true;
    }
    this.read();
    try {
      this.watcher = fs.watch(this.file, () => this.read());
      this.watcher.on('error', () => this.watcher?.close());
    } catch {
      // Watching is an optimisation; the poll below still works.
    }
    this.timer = setInterval(() => this.read(), this.options.pollMs ?? 1000);
  }

  /** Reads whatever has been appended. Safe to call at any time. */
  read(): void {
    if (this.disposed) return;
    if (this.reading) {
      // Called from inside onLines: the running read picks the change up.
      this.pending = true;
      return;
    }
    this.reading = true;
    try {
      do {
        this.pending = false;
        while (!this.disposed && this.readChunk()) {
          // More was written than one chunk holds; keep going.
        }
      } while (this.pending && !this.disposed);
    } finally {
      this.reading = false;
    }
  }

  /** Reads one chunk and emits its lines; true if more is waiting. */
  private readChunk(): boolean {
    let size: number;
    let identity: string | undefined;
    try {
      const stat = fs.statSync(this.file);
      size = stat.size;
      identity = identityOf(stat);
    } catch {
      return false;
    }
    const replaced =
      identity !== undefined &&
      this.identity !== undefined &&
      identity !== this.identity;
    this.identity = identity ?? this.identity;
    if (size < this.offset || replaced) {
      // Truncated or replaced: start over.
      this.offset = 0;
      this.remainder = Buffer.alloc(0);
      this.skipFirstLine = false;
    }
    if (size === this.offset) return false;

    const length = Math.min(
      size - this.offset,
      this.options.maxReadBytes ?? MAX_READ_BYTES,
    );
    const chunk = Buffer.alloc(length);
    let bytesRead: number;
    try {
      const fd = fs.openSync(this.file, 'r');
      try {
        bytesRead = fs.readSync(fd, chunk, 0, length, this.offset);
      } finally {
        fs.closeSync(fd);
      }
    } catch {
      // Gone or locked since the size check: the next poll tries again.
      return false;
    }
    if (bytesRead === 0) return false;
    this.offset += bytesRead;

    const data = Buffer.concat([this.remainder, chunk.subarray(0, bytesRead)]);
    const lines: string[] = [];
    let start = 0;
    for (let i = 0; i < data.length; i++) {
      if (data[i] !== 0x0a) continue;
      if (this.skipFirstLine) {
        this.skipFirstLine = false;
      } else {
        const line = data.subarray(start, i).toString('utf8').trim();
        if (line) lines.push(line);
      }
      start = i + 1;
    }
    this.remainder = Buffer.from(data.subarray(start));
    if (this.remainder.length > (this.options.maxLineBytes ?? MAX_LINE_BYTES)) {
      // Not a log record (a corrupt or binary file): skip to its newline.
      this.remainder = Buffer.alloc(0);
      this.skipFirstLine = true;
    }
    if (lines.length) this.onLines(lines);
    return this.offset < size;
  }

  dispose(): void {
    this.disposed = true;
    this.watcher?.close();
    if (this.timer) clearInterval(this.timer);
  }
}

/**
 * Which file this is (its inode, or file index on Windows). A log replaced by
 * a new file, even one as large, gets a new one. Undefined where the file
 * system reports none. Not the creation time: where that is missing, Node
 * may report the change time, which moves on every append.
 */
function identityOf(stat: fs.Stats): string | undefined {
  return stat.ino ? String(stat.ino) : undefined;
}

/** Whether the byte before `offset` is a newline. */
function followsNewline(file: string, offset: number): boolean {
  const byte = Buffer.alloc(1);
  try {
    const fd = fs.openSync(file, 'r');
    try {
      return fs.readSync(fd, byte, 0, 1, offset - 1) === 1 && byte[0] === 0x0a;
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return false;
  }
}

/** Parses JSONL lines, silently skipping any that are not valid JSON. */
export function parseLines(lines: string[]): unknown[] {
  const records: unknown[] = [];
  for (const line of lines) {
    try {
      records.push(JSON.parse(line));
    } catch {
      // A corrupt or half-written line: skip it rather than fail the feed.
    }
  }
  return records;
}
