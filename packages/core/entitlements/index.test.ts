// The public surface keeps its names, and keeps the signing side out of the app.
import { describe, expect, it } from 'vitest';
import type { Entitlements } from '../types/index.ts';
import * as kit from './index.ts';

describe('entitlements public surface', () => {
  it('exports what the shell and the games use', () => {
    for (const name of [
      'bootEntitlements', 'createEntitlements', 'webPlans', 'playPlans', 'paywallModel', 'verifyToken', 'canUse', 'toShellPort', 'twaHint', 'detectBilling',
      'createServerProvider', 'createGumroadProvider', 'createPlayProvider', 'PLANS', 'PLAN_IDS', 'SOLD_PLAN_IDS', 'PLAY_PRODUCTS', 'GUMROAD_LEGACY_PRODUCTS',
      'API', 'standingOf', 'needsRefresh', 'loadDeviceId', 'CANCELLED', 'subscriptionEnd', 'judgePurchase',
    ]) {
      expect((kit as Record<string, unknown>)[name], name).toBeDefined();
    }
  });

  it('does not carry the signing side: that stays on the server', () => {
    for (const name of ['signToken', 'generateSigningKeys', 'importSigningKey', 'parsePrivateJwk', 'publicKeyOf', 'thumbprint']) {
      expect((kit as Record<string, unknown>)[name], name).toBeUndefined();
    }
  });

  it('a manager is the contract\'s Entitlements', () => {
    const e: Entitlements = {} as kit.EntitlementsService;
    expect(e).toBeDefined();
  });
});
