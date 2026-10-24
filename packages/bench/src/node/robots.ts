import robotsParser from 'robots-parser';

export type Robot = ReturnType<typeof robotsParser>;
/** A parsed robots.txt, `null` for "allow everything" (4xx), or the reason it could not be read. */
export type RobotsRule = Robot | null | { unavailable: string };

/**
 * Reads `<origin>/robots.txt` through `get`. A 4xx means no robots.txt, so everything is
 * allowed (`null`); a network error or 5xx gives `{ unavailable }`, which RFC 9309 asks crawlers
 * to treat as disallowing everything. Shared by `ce pack from-urls` and `ce site`.
 */
export async function readRobots(
  get: (url: string) => Promise<Response>,
  origin: string,
): Promise<RobotsRule> {
  const robotsUrl = `${origin}/robots.txt`;
  let res: Response;
  let body: string | undefined;
  try {
    res = await get(robotsUrl);
    // The body can fail too (a reset connection, or the timeout firing mid-read).
    if (res.ok) body = await res.text();
  } catch {
    return { unavailable: 'robots.txt unavailable (network error)' };
  }
  if (body !== undefined) return robotsParser(robotsUrl, body);
  if (res.status >= 400 && res.status < 500) return null;
  return { unavailable: `robots.txt unavailable (HTTP ${res.status})` };
}
