// Small text helpers shared by the adapters.

const INJECTED_TAGS = [
  'system-reminder',
  'environment_context',
  'app-context',
  'command-message',
  'local-command-stdout',
];

/**
 * Removes context the harness injects into the user's messages. Only for
 * prompts: in tool output the same tags could hide instructions planted in
 * a web page or file from the person watching, so they are shown there.
 *
 * Linear time, whatever the input: a regex here was quadratic on many
 * unclosed tags, and a hostile result could stall the extension host.
 */
export function stripInjected(text: string): string {
  if (!text.includes('<')) return text.trim();
  // Where each tag's last closing tag is: an opening tag after it has none.
  const lastClose = new Map(
    INJECTED_TAGS.map((tag) => [tag, text.lastIndexOf(`</${tag}>`)]),
  );
  let out = '';
  let from = 0;
  let at = text.indexOf('<');
  while (at !== -1) {
    const tag = INJECTED_TAGS.find((t) => text.startsWith(`<${t}>`, at));
    const close = `</${tag}>`;
    const end = tag && at < lastClose.get(tag)! ? text.indexOf(close, at) : -1;
    if (end === -1) {
      at = text.indexOf('<', at + 1);
      continue;
    }
    out += text.slice(from, at);
    from = end + close.length;
    at = text.indexOf('<', from);
  }
  return (out + text.slice(from)).trim();
}

export function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  let end = max - 1;
  // Don't cut an emoji (a surrogate pair) in half.
  const last = text.charCodeAt(end - 1);
  if (last >= 0xd800 && last <= 0xdbff) end--;
  return text.slice(0, end).trimEnd() + '…';
}

/**
 * Characters that change how text reads without being seen: bidi controls
 * (which can make a command display in a different order than it runs, the
 * "Trojan Source" trick), zero-width characters and other invisible format
 * characters.
 */
const INVISIBLE =
  /[\u00ad\u061c\u115f\u1160\u180e\u200b-\u200f\u202a-\u202e\u2060-\u2064\u2066-\u206f\u3164\ufeff\uffa0]|[\u{e0000}-\u{e007f}]/gu;

/** Shows invisible characters as `⟨U+202E⟩`, so what is shown is what ran. */
export function revealInvisible(text: string): string {
  return text.replace(
    INVISIBLE,
    (c) =>
      `⟨U+${c.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')}⟩`,
  );
}

/** Whether `revealInvisible` would change the text. */
export function hasInvisible(text: string): boolean {
  INVISIBLE.lastIndex = 0;
  return INVISIBLE.test(text);
}

/**
 * The start of a tool's output, saying how much more there was: whatever
 * comes after the cut is never shown, so the reader should know it exists.
 */
export function preview(text: string, max: number): string {
  if (text.length <= max) return text;
  let end = max;
  const last = text.charCodeAt(end - 1);
  if (last >= 0xd800 && last <= 0xdbff) end--;
  const rest = text.length - end;
  const size =
    rest < 1024 ? `${rest} characters` : `${Math.round(rest / 1024)} KB`;
  return `${text.slice(0, end).trimEnd()}\n… ${size} more not shown`;
}

export function firstLine(text: string): string {
  const line = text.split(/\r?\n/, 1)[0] ?? '';
  return line.trim();
}

export function basename(p: string): string {
  const parts = p.split(/[\\/]/);
  return parts[parts.length - 1] || p;
}

/** Flattens tool output (a string or a list of content blocks) to text. */
export function contentToText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  const parts: string[] = [];
  for (const block of content) {
    if (typeof block === 'string') parts.push(block);
    else if (block && typeof block === 'object') {
      const b = block as Record<string, unknown>;
      if (typeof b.text === 'string') parts.push(b.text);
      else if (b.type === 'image' || b.type === 'input_image')
        parts.push('[image]');
    }
  }
  return parts.join('\n');
}

export function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

export function str(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}
