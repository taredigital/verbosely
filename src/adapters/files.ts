import * as fs from 'fs';
import * as path from 'path';
import { asRecord } from '../core/text';

// File helpers shared by the adapters. Every read is bounded and never
// throws: a missing or unreadable file reads as nothing.

/** A path in a comparable form: resolved, no trailing slash, any case on Windows. */
export function normalizePath(p: string): string {
  const normal = path.resolve(p).replace(/[\\/]+$/, '');
  return process.platform === 'win32' ? normal.toLowerCase() : normal;
}

/** A JSON object from a small file, or undefined. */
export function readJson(file: string): Record<string, unknown> | undefined {
  try {
    return asRecord(JSON.parse(fs.readFileSync(file, 'utf8')));
  } catch {
    return undefined;
  }
}

/** Up to `length` bytes from `position`, as text ('' if unreadable). */
export function readChunk(
  file: string,
  position: number,
  length: number,
): string {
  let fd: number | undefined;
  try {
    const buffer = Buffer.alloc(length);
    fd = fs.openSync(file, 'r');
    const read = fs.readSync(fd, buffer, 0, length, position);
    return buffer.subarray(0, read).toString('utf8');
  } catch {
    return '';
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

/** The last `length` bytes of a file, as text ('' if unreadable). */
export function readTail(file: string, length: number): string {
  let size: number;
  try {
    size = fs.statSync(file).size;
  } catch {
    return '';
  }
  const bytes = Math.min(size, length);
  return readChunk(file, size - bytes, bytes);
}
