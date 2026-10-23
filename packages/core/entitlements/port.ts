// The entitlements as the web shell wants them (packages/web/src/app/ports.ts: EntitlementsPort), declared here as the
// same shape so the shell can take this object as it is and entitlements never imports the interface layer.
import type { ActivateFailureCode, Plan, Unsubscribe } from '../types/index.ts';
import type { EntitlementsService } from './manager.ts';

export interface ShellEntitlementsPort {
  plan(): Plan;
  onChange(cb: (plan: Plan) => void): Unsubscribe;
  /** A licence key typed in by the player. Never throws. */
  activate(key: string): Promise<{ ok: true; plan: Plan } | { ok: false; code: ActivateFailureCode }>;
  /** Android only. */
  restore?(): Promise<boolean>;
  /** Android only: `productId` is the Play product id of the offer (checkout.play). */
  purchase?(productId: string): Promise<boolean>;
}

export interface PortOptions {
  /** True in the Android build, where Google Play is the only shop. */
  play: boolean;
}

export function toShellPort(s: EntitlementsService, o: PortOptions): ShellEntitlementsPort {
  const port: ShellEntitlementsPort = {
    plan: () => s.current().plan,
    onChange(cb) {
      let last = s.current().plan;
      return s.onChange((e) => {
        if (e.plan === last) return;                // a renewed token under the same plan is not news to the screens
        last = e.plan;
        cb(e.plan);
      });
    },
    async activate(key) {
      try {
        const r = await s.activateKey(key);
        return r.ok ? { ok: true, plan: r.e.plan } : { ok: false, code: r.code };
      } catch {
        return { ok: false, code: 'server' };
      }
    },
  };
  if (o.play) {
    port.restore = async () => {
      try { return (await s.restore()).ok; } catch { return false; }
    };
    port.purchase = async (productId) => {
      try { return (await s.purchase(productId)).ok; } catch { return false; }
    };
  }
  return port;
}
