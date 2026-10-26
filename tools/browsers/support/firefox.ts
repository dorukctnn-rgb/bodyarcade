// The one set of Firefox preferences every QA tool launches with (the browser matrix, the engine probe, the page check): its fake camera and no
// permission prompt. BA_BROWSERS_NOWEBGL=1 switches WebGL off, to see here what a Firefox with no WebGL does: the pose model (MediaPipe makes a GL context
// even on the CPU delegate) cannot run and a round ends with "the camera stopped" (that is also what GitHub's Linux runner gives Firefox: no GL there,
// "webgl.force-enabled" does not change it, QA run 40205601198).

export const FIREFOX_PEERS = { 'media.peerconnection.ice.obfuscate_host_addresses': false, 'media.peerconnection.ice.loopback': true } as const;

export function firefoxPrefs(extra: Record<string, string | number | boolean> = {}): Record<string, string | number | boolean> {
  return {
    'media.navigator.streams.fake': true,
    'media.navigator.permission.disabled': true,
    ...(process.env['BA_BROWSERS_NOWEBGL'] ? { 'webgl.disabled': true } : {}),
    ...extra,
  };
}
