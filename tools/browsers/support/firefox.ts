// The one set of Firefox preferences every QA tool launches with (the browser matrix, the engine probe, the page check): its fake camera and no
// permission prompt, and WebGL forced on past Firefox's driver blocklist. Headless Firefox on GitHub's Linux runner (no GPU) says "WebGL creation
// failed" for a blocklisted driver, and without any WebGL the pose model (MediaPipe makes a GL context even on the CPU delegate) and every 3D scene
// cannot run, which looks like a broken camera ("the camera stopped") in the camera flows. Forcing it lets Mesa's software GL (llvmpipe) answer where it exists.
// BA_BROWSERS_NOWEBGL=1 turns WebGL off instead, to see here what a Firefox with no WebGL does (a hardened or blocklisted browser).

export const FIREFOX_PEERS = { 'media.peerconnection.ice.obfuscate_host_addresses': false, 'media.peerconnection.ice.loopback': true } as const;

export function firefoxPrefs(extra: Record<string, string | number | boolean> = {}): Record<string, string | number | boolean> {
  const noWebgl = !!process.env['BA_BROWSERS_NOWEBGL'];
  return {
    'media.navigator.streams.fake': true,
    'media.navigator.permission.disabled': true,
    ...(noWebgl ? { 'webgl.disabled': true } : { 'webgl.force-enabled': true, 'webgl.enable-webgl2': true }),
    ...extra,
  };
}
