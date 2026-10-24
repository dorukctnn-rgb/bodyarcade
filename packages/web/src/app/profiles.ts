// The players screens in the browser: who is playing, the list to manage, the form to add or edit a player, the removal that asks
// first, and the parent gate every one of those uses when the profile book says "parent_gate". The rules (who may do what, what a
// child may not) are the book's (core/store/profiles.ts); this draws the answers and asks the parent when the book wants one.
import type { ParentGate, ProfileBook, ProfilePatch, ProfileSpace, RemovalPlan } from '../../../core/store/index.ts';
import { AVATARS } from '../../../core/store/index.ts';
import { openDialog } from '../../../core/ui/dialog.ts';
import type { Matched } from '../../../core/ui/router.ts';
import type { ViewContext } from '../context.ts';
import type { RouteId } from '../routes.ts';
import { gateHtml } from '../views/profiles.ts';
import type { ConfirmOptions } from '../views/misc.ts';
import {
  draftOf, failureKey, newDraft, NO_PROFILES_STATE, safeNext, waitText, type FormDraft, type FormField, type ProfilesPageState, type ProfilesView,
} from './profiles-model.ts';

// ---- the parent gate ---------------------------------------------------------------------------------------------------------

export interface GateHost {
  document: Document;
  context(): ViewContext;
}

/**
 * A sum for a grown-up, in a window of its own. Resolves true when it was answered (the gate then stays open for five minutes and
 * the caller runs what it was asked for again), false when the window was closed. A wrong answer gives another question; three wrong
 * answers close the gate for a while and the window says for how long, counting down; a reload does not open it again (the book
 * keeps the count).
 */
export function askParentGate(host: GateHost, gate: ParentGate): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    let passed = false;
    let message: string | null = null;
    let waiting: { until: number } | null = null;
    let question: { id: string; a: number; b: number } | null = null;
    let timer: ReturnType<typeof setInterval> | null = null;
    const t = (): ViewContext['i18n'] => host.context().i18n;

    const waitLine = (): string | null => {
      if (!waiting) return null;
      const w = waitText(Math.max(0, waiting.until - Date.now()));
      return w.unit === 'sec' ? t().t('profile.gate.wait', { n: w.n }) : t().t('profile.gate.waitMin', { n: w.n });
    };
    const ask = (): void => {
      const r = gate.ask();
      if (r.ok) { question = r.question; waiting = null; return; }
      question = null;
      waiting = { until: Date.now() + r.retryAfterMs };
    };
    const html = (): ReturnType<typeof gateHtml> => gateHtml(host.context(), { a: question?.a ?? 0, b: question?.b ?? 0, message, waitText: waitLine() });

    ask();
    const dialog = openDialog({ document: host.document, html: html(), labelledBy: 'gate-title', describedBy: 'gate-body', initialFocus: '#gate-answer', className: 'pf-gatebox' });
    const redraw = (): void => dialog.setHtml(html());

    // While the gate is closed the window counts down, then asks again by itself.
    const tick = (): void => {
      if (!waiting) return;
      if (Date.now() >= waiting.until) { ask(); message = null; }
      redraw();
    };
    timer = setInterval(tick, 1000);

    dialog.el.addEventListener('submit', (e) => {
      e.preventDefault();
      if (!question) return;
      const field = dialog.el.querySelector<HTMLInputElement>('#gate-answer');
      const r = gate.answer(question.id, (field?.value ?? '').trim());
      if (r.ok) { passed = true; dialog.close('yes'); return; }
      if (r.code === 'wrong') { question = r.next; message = t().t('profile.gate.wrong'); waiting = null; }
      else if (r.code === 'wait') { question = null; message = null; waiting = { until: Date.now() + r.retryAfterMs }; }
      else { ask(); message = null; }
      redraw();
    });

    void dialog.closed.then(() => {
      if (timer) clearInterval(timer);
      resolve(passed);
    });
  });
}

// ---- the page ----------------------------------------------------------------------------------------------------------------

export interface ProfilesHost extends GateHost {
  book: ProfileBook;
  /** A different player plays now: the app builds its services around their record. */
  played(space: ProfileSpace): void;
  /** The active player's own settings may have changed (their seated switch). */
  updated(): void;
  go(href: string, o?: { replace?: boolean }): void;
  toast(text: string, kind?: 'warn'): void;
  announce(text: string): void;
  confirm(o: ConfirmOptions): Promise<boolean>;
  /** The state of the page changed: draw it again. */
  redraw(): void;
  now(): number;
}

type Verdict = { ok: boolean; code?: string };

export class ProfilesController {
  private readonly host: ProfilesHost;
  private st: ProfilesPageState = NO_PROFILES_STATE;
  private busy = false;

  constructor(host: ProfilesHost) {
    this.host = host;
  }

  /** The page is entered (from an address): the picker is read afresh and the way on is remembered. */
  enter(route: Matched<RouteId>): void {
    this.st = { ...NO_PROFILES_STATE, next: safeNext(route.query.get('next')), view: route.query.get('manage') === '1' ? { kind: 'manage' } : { kind: 'pick' } };
    this.refresh();
  }

  /** What the page is drawn from. */
  state(): ProfilesPageState { return this.st; }

  /** The book changed (another tab, the plan): the cards are read again. */
  refresh(): void {
    this.st = { ...this.st, picker: this.host.book.picker() };
  }

  private set(patch: Partial<ProfilesPageState>): void {
    this.st = { ...this.st, ...patch, picker: this.host.book.picker() };
    this.host.redraw();
  }

  private say(text: string, kind?: 'warn'): void {
    this.host.announce(text);
    this.host.toast(text, kind);
  }

  private words(code: string): string {
    return this.host.context().i18n.t(failureKey(code) as 'profile.err.unknown', { n: 20 });
  }

  /** Runs what the book would do; when it wants a grown-up the gate comes up and, once answered, the same call is made again. */
  private async viaGate<R extends Verdict>(run: () => R): Promise<R> {
    let r = run();
    while (!r.ok && r.code === 'parent_gate') {
      if (!(await askParentGate(this.host, this.host.book.gate))) return r;
      r = run();
    }
    return r;
  }

  // ---- clicks -------------------------------------------------------------------------------------------------------------------

  action(name: string, el: HTMLElement): boolean {
    switch (name) {
      case 'profile-pick': void this.pick(el.dataset['id'] ?? ''); return true;
      case 'profile-gate': void this.openGuard(); return true;
      case 'profile-manage': void this.manage(); return true;
      case 'profile-done': this.set({ view: { kind: 'pick' }, notice: null }); return true;
      case 'profile-add': void this.add(); return true;
      case 'profile-edit': void this.edit(el.dataset['id'] ?? ''); return true;
      case 'profile-remove': void this.remove(el.dataset['id'] ?? ''); return true;
      case 'profile-cancel': this.set({ view: { kind: 'manage' }, notice: null }); return true;
      default: return false;
    }
  }

  /** The switch that says whether to ask who is playing when the app opens. */
  change(el: HTMLInputElement): boolean {
    if (el.name !== 'askOnStart') return false;
    void (async () => {
      const r = await this.viaGate(() => this.host.book.setAskOnStart(el.checked));
      if (!r.ok && r.code !== 'parent_gate') this.say(this.words(r.code ?? 'unknown'), 'warn');
      this.set({});
    })();
    return true;
  }

  private async pick(id: string): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      const r = await this.viaGate(() => this.host.book.switchTo(id));
      if (!r.ok) {
        if (r.code !== 'parent_gate') this.say(this.words(r.code), 'warn');
        this.set({});
        return;
      }
      if (r.changed) this.host.played(r.space);
      this.host.go(this.st.next ?? this.host.context().href('home'), { replace: true });
    } finally {
      this.busy = false;
    }
  }

  /** The guard is on: a grown-up answers, and then the main player is the one that plays. */
  private async openGuard(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      const book = this.host.book;
      if (!(await askParentGate(this.host, book.gate))) return;
      book.refresh();
      this.set({});
    } finally {
      this.busy = false;
    }
  }

  private async manage(): Promise<void> {
    // Changing the list needs the owner at play or the gate open: the gate comes first when it is neither.
    if (!this.host.book.picker().manage && !(await askParentGate(this.host, this.host.book.gate))) return;
    this.set({ view: { kind: 'manage' }, notice: null });
  }

  private async add(): Promise<void> {
    const book = this.host.book;
    if (!book.picker().manage && !(await askParentGate(this.host, book.gate))) return;
    const used = new Set(book.list().map((p) => p.avatar));
    const avatar = AVATARS.find((a) => !used.has(a)) ?? AVATARS[0];
    this.set({ view: { kind: 'form', mode: 'create', id: null, draft: newDraft(avatar, this.host.context().settings.seated), error: null }, notice: null });
  }

  private async edit(id: string): Promise<void> {
    const book = this.host.book;
    const p = book.get(id);
    if (!p) { this.say(this.words('unknown'), 'warn'); this.set({ view: { kind: 'manage' } }); return; }
    const mine = book.active().id === id;
    // A player may change their own name, picture and seat; everything else is a grown-up's.
    if (!mine && !book.picker().manage && !(await askParentGate(this.host, book.gate))) return;
    this.set({ view: { kind: 'form', mode: 'edit', id, draft: draftOf(p), error: null }, notice: null });
  }

  /** A player and their record go (the main player's record is cleared), after the grown-up has answered and the screen has asked. */
  async remove(id: string): Promise<void> {
    const book = this.host.book;
    const plan = await this.viaGate(() => book.planRemoval(id));
    if (!plan.ok) {
      if (plan.code !== 'parent_gate') this.say(this.words(plan.code), 'warn');
      this.set({});
      return;
    }
    const sure = await this.host.confirm(this.removalText(plan));
    if (!sure) return;
    const r = await this.viaGate(() => book.remove(id, plan.token));
    if (!r.ok) {
      if (r.code !== 'parent_gate') this.say(this.words(r.code), 'warn');
      this.set({});
      return;
    }
    const t = this.host.context().i18n;
    const text = plan.action === 'reset' ? t.t('profile.reset.done') : t.t('profile.removed', { name: plan.summary.name });
    // The player who was playing may be the one removed: the book moved the page to the main player.
    this.host.played(book.open());
    this.say(text);
    this.set({ view: { kind: 'manage' }, notice: text });
  }

  private removalText(plan: RemovalPlan): ConfirmOptions {
    const t = this.host.context().i18n;
    const reset = plan.action === 'reset';
    return {
      title: reset ? t.t('profile.reset.title') : t.t('profile.remove.title', { name: plan.summary.name }),
      body: reset ? t.t('profile.reset.body') : t.t('profile.remove.body', { name: plan.summary.name, runs: plan.summary.runs }),
      confirm: reset ? t.t('profile.reset.confirm') : t.t('profile.remove.confirm'),
      cancel: t.t('common.cancel'),
      danger: true,
    };
  }

  // ---- the form -------------------------------------------------------------------------------------------------------------------

  /** Reads the form into a draft (what the fields hold now). */
  private draftFrom(form: HTMLFormElement): FormDraft {
    const data = new FormData(form);
    const avatar = String(data.get('avatar') ?? '');
    const known = (AVATARS as readonly string[]).includes(avatar) ? (avatar as FormDraft['avatar']) : (AVATARS[0] as FormDraft['avatar']);
    return { name: String(data.get('name') ?? ''), avatar: known, kid: form.querySelector<HTMLInputElement>('[name="kid"]')?.checked === true, seated: form.querySelector<HTMLInputElement>('[name="seated"]')?.checked === true };
  }

  submit(form: HTMLFormElement): boolean {
    if (!form.matches('[data-form="profile"]')) return false;
    const view = this.st.view;
    if (view.kind !== 'form') return true;
    void this.save(view, this.draftFrom(form));
    return true;
  }

  private async save(view: Extract<ProfilesView, { kind: 'form' }>, draft: FormDraft): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      const book = this.host.book;
      const fail = (code: string): void => {
        const field: FormField = code.startsWith('name_') ? 'name' : code === 'avatar' ? 'avatar' : 'form';
        this.set({ view: { ...view, draft, error: { field, code } } });
        this.host.announce(this.words(code));
      };
      const t = this.host.context().i18n;
      if (view.mode === 'create') {
        const r = await this.viaGate(() => book.create({ name: draft.name, avatar: draft.avatar, kid: draft.kid, seated: draft.seated }));
        if (!r.ok) { if (r.code !== 'parent_gate') fail(r.code); return; }
        const text = t.t('profile.created', { name: r.profile.name });
        this.say(text);
        this.set({ view: { kind: 'manage' }, notice: text });
        return;
      }
      const id = view.id ?? '';
      const owner = book.get(id)?.owner === true;
      const patch: ProfilePatch = { name: draft.name, avatar: draft.avatar, seated: draft.seated, ...(owner ? {} : { kid: draft.kid }) };
      const r = await this.viaGate(() => book.update(id, patch));
      if (!r.ok) { if (r.code !== 'parent_gate') fail(r.code); return; }
      if (book.active().id === id) this.host.updated();
      const text = t.t('profile.saved');
      this.say(text);
      this.set({ view: { kind: 'manage' }, notice: text });
    } finally {
      this.busy = false;
    }
  }
}
