import { useEffect, useState } from 'preact/hooks';
import { formatDuration, MIN_SHOWN_MS, since } from '../core/time';

/**
 * How long something has been running, ticking each second. Renders nothing
 * for the first second, like the finished durations.
 */
export function Elapsed({
  from,
  prefix = '',
}: {
  from: string;
  prefix?: string;
}) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(tick);
  }, []);
  const ms = since(from, now);
  return ms !== undefined && ms >= MIN_SHOWN_MS ? (
    <>
      {prefix}
      {formatDuration(ms)}
    </>
  ) : null;
}
