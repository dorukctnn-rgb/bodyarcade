// @mediapipe/tasks-vision 1.1.x posts usage statistics (task name, running mode, timings; no images) to
// https://odml.pa.googleapis.com/v1/log every 60 s and when a task closes. BodyArcade promises that nothing about a
// player leaves the device and self-hosts every pose file to keep Google off the page (tech.md 3.2), so these posts
// are answered locally instead. The library treats the non-200 answer as a failed send and stops logging.
// The production CSP (connect-src 'self') is the second guard.

const BLOCKED_HOSTS = ['odml.pa.googleapis.com'];

type Guarded = typeof fetch & { __baTelemetryGuard?: true };

export const telemetry = { blocked: 0 };

function hostOf(input: RequestInfo | URL): string {
  try {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    return new URL(url, (globalThis as { location?: { href: string } }).location?.href ?? 'http://localhost/').hostname;
  } catch {
    return '';
  }
}

/** Installs the guard in this realm (window or worker). Safe to call more than once. */
export function blockPoseTelemetry(): void {
  const g = globalThis as { fetch?: Guarded };
  const original = g.fetch;
  if (typeof original !== 'function' || original.__baTelemetryGuard) return;
  const guarded = ((input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    if (BLOCKED_HOSTS.includes(hostOf(input))) {
      telemetry.blocked++;
      return Promise.resolve(new Response(null, { status: 204, statusText: 'Blocked by BodyArcade' }));
    }
    return original(input, init);
  }) as Guarded;
  guarded.__baTelemetryGuard = true;
  g.fetch = guarded;
}
