/**
 * Shown with every bench output (CLI text, JSON report and UI panel) when the model runs on this
 * machine: the default Ollama path, or an OpenAI-compatible server on localhost.
 */
export const CAVEAT =
  'Content check on a local model over a fixed page set. It does not predict live AI engines.';

/**
 * Shown in place of CAVEAT when the bench cannot vouch that the model is local (Ruling R32): a
 * server on another host, such as a hosted OpenAI-compatible API, or answers replayed from a file.
 */
export const REMOTE_CAVEAT =
  'Content check on a model over a fixed page set. It does not predict live AI engines.';

/** Shown with every `ce live` output (CLI text and LiveReport), in place of CAVEAT. */
export const LIVE_CAVEAT =
  'Measured through an API, which can differ from what people see in the consumer app.';

/**
 * True when `url` names this machine: localhost (or a *.localhost name), 127.0.0.0/8 or ::1.
 * Anything else, a LAN address included, may be another machine and is not called local.
 */
export function isLocalUrl(url: string): boolean {
  let host: string;
  try {
    // A bare host:port (Ollama accepts one) is read as http.
    const full = /^[a-z][a-z0-9+.-]*:\/\//i.test(url.trim()) ? url.trim() : `http://${url.trim()}`;
    host = new URL(full).hostname.toLowerCase();
  } catch {
    return false;
  }
  return (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host === '[::1]' ||
    /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host)
  );
}

/** The bench caveat for a model server at `url`: CAVEAT when it is local, REMOTE_CAVEAT otherwise. */
export function caveatFor(url: string): string {
  return isLocalUrl(url) ? CAVEAT : REMOTE_CAVEAT;
}
