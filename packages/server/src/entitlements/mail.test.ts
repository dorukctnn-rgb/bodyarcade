// The mail service call: the request ForwardEmail's API wants, and what each answer means for the reminder.
import { describe, expect, it } from 'vitest';
import { FORWARD_EMAIL_API, createForwardEmailSender } from './mail.ts';
import type { FetchFn } from './upstream/gumroad.ts';

const MSG = { to: 'player@example.com', subject: 'Subject line', text: 'Body text\n' };

describe('the ForwardEmail sender', () => {
  it('posts JSON with the token as the basic-auth user, from the configured sender', async () => {
    const seen: { url: string; init?: RequestInit }[] = [];
    const f: FetchFn = async (url, init) => { seen.push({ url, ...(init ? { init } : {}) }); return new Response('{}', { status: 200 }); };
    expect(await createForwardEmailSender({ token: 'fe-token-12345', from: 'BodyArcade <info@bodyarcade.com>', fetch: f }).send(MSG)).toBe('sent');
    expect(seen).toHaveLength(1);
    expect(seen[0]?.url).toBe(FORWARD_EMAIL_API);
    expect(seen[0]?.init?.method).toBe('POST');
    const headers = seen[0]?.init?.headers as Record<string, string>;
    expect(headers['Content-Type']).toBe('application/json');
    expect(headers['Authorization']).toBe(`Basic ${btoa('fe-token-12345:')}`);
    expect(JSON.parse(String(seen[0]?.init?.body))).toEqual({ from: 'BodyArcade <info@bodyarcade.com>', to: 'player@example.com', subject: 'Subject line', text: 'Body text\n' });
  });

  it.each([
    [200, 'sent'], [201, 'sent'], [202, 'sent'],
    [400, 'drop'], [404, 'drop'], [422, 'drop'],
    [401, 'retry'], [403, 'retry'], [408, 'retry'], [429, 'retry'], [500, 'retry'], [502, 'retry'], [503, 'retry'],
  ] as const)('%i is "%s"', async (status, result) => {
    const f: FetchFn = async () => new Response('{}', { status });
    expect(await createForwardEmailSender({ token: 'fe-token-12345', from: 'a@b.co', fetch: f }).send(MSG)).toBe(result);
  });

  it('is "retry" when the service cannot be reached or is too slow, and never throws', async () => {
    expect(await createForwardEmailSender({ token: 'fe-token-12345', from: 'a@b.co', fetch: async () => { throw new TypeError('offline'); } }).send(MSG)).toBe('retry');
    const slow: FetchFn = (_u, init) => new Promise((_res, rej) => { init?.signal?.addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError'))); });
    expect(await createForwardEmailSender({ token: 'fe-token-12345', from: 'a@b.co', fetch: slow, timeoutMs: 20 }).send(MSG)).toBe('retry');
  });
});
