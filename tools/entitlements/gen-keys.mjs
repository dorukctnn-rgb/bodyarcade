#!/usr/bin/env node
// Makes the ES256 key pair that signs entitlement tokens.
//
//   node tools/entitlements/gen-keys.mjs
//
// Prints two things, nothing is written to disk:
//   PRIVATE  one line of JSON. Put it into the Worker secret:   npx wrangler secret put ENT_PRIV_JWK
//            Never commit it, never paste it into a chat, never put it in wrangler.jsonc or a .dev.vars that is tracked.
//   PUBLIC   one line of JSON. It goes into the web app's configuration (the `keys` option of bootEntitlements); it is
//            safe to commit, and tokens can be checked offline with it.
//
// To replace a key later: make a new pair, add the new PUBLIC key next to the old one in the app, ship the app, then
// switch the secret. Tokens signed with the old key stay valid in the field (they live at most 7 days).
import { pathToFileURL } from 'node:url';

const utf8 = new TextEncoder();
const b64url = (bytes) => Buffer.from(bytes).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/** RFC 7638 thumbprint of the public key, shortened: the key's name (kid) in every token header. */
export async function thumbprint(jwk) {
  const text = `{"crv":"P-256","kty":"EC","x":${JSON.stringify(jwk.x)},"y":${JSON.stringify(jwk.y)}}`;
  return b64url(new Uint8Array(await crypto.subtle.digest('SHA-256', utf8.encode(text)))).slice(0, 16);
}

export async function generate() {
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const priv = await crypto.subtle.exportKey('jwk', pair.privateKey);
  const pub = await crypto.subtle.exportKey('jwk', pair.publicKey);
  const kid = await thumbprint(pub);
  return {
    kid,
    privateJwk: { kty: 'EC', crv: 'P-256', x: priv.x, y: priv.y, d: priv.d, kid },
    publicKey: { kid, jwk: { kty: 'EC', crv: 'P-256', x: pub.x, y: pub.y } },
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { privateJwk, publicKey } = await generate();
  console.log('PRIVATE (Worker secret ENT_PRIV_JWK; keep it out of git and out of chats):');
  console.log(JSON.stringify(privateJwk));
  console.log('');
  console.log('PUBLIC (app configuration; safe to commit):');
  console.log(JSON.stringify(publicKey));
}
