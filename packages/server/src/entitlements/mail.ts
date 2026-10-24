// The one e-mail the app promises on the web: two days before a free trial ends, to a player who gave an address for it.
// Plain text, five languages, no tracking, no marketing, and the address is deleted when the mail has been sent.
//
// The sender is behind a small interface (MailSender) so tests use a fake one. The real one speaks ForwardEmail's HTTP API,
// the mail service Peak Apps Studio already pays for (ENT_MAIL_TOKEN is its API token, ENT_MAIL_FROM the sender address,
// which must be an address the account may send from). Another service only needs another createXxxSender.
import type { ReminderLang } from '../../../core/entitlements/api.ts';
import type { FetchFn } from './upstream/gumroad.ts';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
}

/** `sent`: delivered to the service. `retry`: try again later (the service was down or slow). `drop`: it will never work (the address is refused). */
export type MailResult = 'sent' | 'retry' | 'drop';

export interface MailSender {
  send(m: MailMessage): Promise<MailResult>;
}

export const FORWARD_EMAIL_API = 'https://api.forwardemail.net/v1/emails';

export interface ForwardEmailOptions {
  token: string;
  from: string;
  fetch?: FetchFn;
  timeoutMs?: number;
}

export function createForwardEmailSender(o: ForwardEmailOptions): MailSender {
  const f: FetchFn = o.fetch ?? ((input, init) => fetch(input, init));
  return {
    async send(m) {
      let status: number;
      try {
        const res = await f(FORWARD_EMAIL_API, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json', Authorization: `Basic ${btoa(`${o.token}:`)}` },
          body: JSON.stringify({ from: o.from, to: m.to, subject: m.subject, text: m.text }),
          signal: AbortSignal.timeout(o.timeoutMs ?? 10_000),
        });
        status = res.status;
        await res.arrayBuffer().catch(() => undefined);
      } catch {
        return 'retry';
      }
      if (status >= 200 && status < 300) return 'sent';
      // 401 and 403 are about our account, 408, 429 and 5xx about the moment: all worth another try. The rest (a bad
      // address, a refused message) will not get better.
      if (status === 401 || status === 403 || status === 408 || status === 429 || status >= 500) return 'retry';
      return 'drop';
    },
  };
}

interface Copy {
  subject: string;
  /** Lines; `{date}` is the end of the trial. */
  body: (date: string) => string[];
}

const COPY: Record<ReminderLang, Copy> = {
  en: {
    subject: 'Your BodyArcade free trial ends in 2 days',
    body: (date) => [
      'Hello,',
      `Your free trial of BodyArcade ends on ${date}. After that the plan renews for a year at the price shown at checkout.`,
      'If you want to keep it, you do not need to do anything.',
      'If you do not want to continue, cancel before then: open your Gumroad library, choose BodyArcade and select "Manage membership". The receipt e-mail from Gumroad has the same link.',
      'You asked for this one reminder when you started the trial. We keep your address only until this e-mail has been sent and will not write to you again.',
      'BodyArcade',
    ],
  },
  tr: {
    subject: 'BodyArcade ücretsiz denemen 2 gün içinde bitiyor',
    body: (date) => [
      'Merhaba,',
      `BodyArcade ücretsiz denemen ${date} tarihinde bitiyor. Ardından plan, ödeme sayfasında gördüğün fiyattan bir yıl için yenilenir.`,
      'Devam etmek istiyorsan bir şey yapman gerekmiyor.',
      'Devam etmek istemiyorsan o tarihten önce iptal et: Gumroad kütüphaneni aç, BodyArcade\'i seç ve "Manage membership" bağlantısına tıkla. Gumroad\'dan gelen makbuz e-postasında da aynı bağlantı var.',
      'Denemeyi başlatırken bu tek hatırlatmayı istemiştin. Adresini yalnızca bu e-posta gönderilene kadar saklıyoruz ve bir daha yazmayacağız.',
      'BodyArcade',
    ],
  },
  de: {
    subject: 'Deine kostenlose BodyArcade-Testphase endet in 2 Tagen',
    body: (date) => [
      'Hallo,',
      `Deine kostenlose Testphase von BodyArcade endet am ${date}. Danach verlängert sich der Tarif für ein Jahr zum Preis, der beim Bezahlen angezeigt wurde.`,
      'Wenn du ihn behalten möchtest, musst du nichts tun.',
      'Wenn du nicht weitermachen möchtest, kündige vorher: Öffne deine Gumroad-Bibliothek, wähle BodyArcade und dann "Manage membership". Die Quittung von Gumroad enthält denselben Link.',
      'Du hast diese eine Erinnerung beim Start der Testphase angefordert. Wir speichern deine Adresse nur, bis diese E-Mail gesendet ist, und schreiben dir nicht wieder.',
      'BodyArcade',
    ],
  },
  es: {
    subject: 'Tu prueba gratuita de BodyArcade termina en 2 días',
    body: (date) => [
      'Hola,',
      `Tu prueba gratuita de BodyArcade termina el ${date}. Después, el plan se renueva por un año al precio que viste al pagar.`,
      'Si quieres conservarlo, no tienes que hacer nada.',
      'Si no quieres continuar, cancela antes: abre tu biblioteca de Gumroad, elige BodyArcade y selecciona "Manage membership". El recibo de Gumroad tiene el mismo enlace.',
      'Pediste este único recordatorio al empezar la prueba. Guardamos tu dirección solo hasta que se envíe este correo y no volveremos a escribirte.',
      'BodyArcade',
    ],
  },
  fr: {
    subject: 'Votre essai gratuit de BodyArcade se termine dans 2 jours',
    body: (date) => [
      'Bonjour,',
      `Votre essai gratuit de BodyArcade se termine le ${date}. Ensuite, l'abonnement se renouvelle pour un an au prix affiché au paiement.`,
      'Si vous souhaitez le garder, vous n\'avez rien à faire.',
      'Si vous ne souhaitez pas continuer, résiliez avant cette date : ouvrez votre bibliothèque Gumroad, choisissez BodyArcade puis "Manage membership". Le reçu de Gumroad contient le même lien.',
      'Vous avez demandé ce seul rappel au début de l\'essai. Nous ne gardons votre adresse que jusqu\'à l\'envoi de ce message et ne vous écrirons plus.',
      'BodyArcade',
    ],
  },
};

const LOCALE: Record<ReminderLang, string> = { en: 'en-GB', tr: 'tr-TR', de: 'de-DE', es: 'es-ES', fr: 'fr-FR' };

/** The end of the trial the way the mail says it: the date and the time in UTC, so it is exact for everyone. */
export function trialEndText(endMs: number, lang: ReminderLang): string {
  try {
    return `${new Date(endMs).toLocaleString(LOCALE[lang], { dateStyle: 'long', timeStyle: 'short', timeZone: 'UTC' })} UTC`;
  } catch {
    return `${new Date(endMs).toISOString().slice(0, 16).replace('T', ' ')} UTC`;
  }
}

export function reminderMail(to: string, lang: ReminderLang, trialEndMs: number): MailMessage {
  const copy = COPY[lang] ?? COPY.en;
  return { to, subject: copy.subject, text: `${copy.body(trialEndText(trialEndMs, lang)).join('\n\n')}\n` };
}
