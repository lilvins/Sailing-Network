// Human-readable descriptions of prompts, actions and effect steps, for a UI and
// for game logs.

import { abilityOf } from './engine/runner.js';
import { findCard } from './engine/state.js';
import type { Action, Db, GameState } from './engine/types.js';

/** "Choice.OppDraw2Cards" -> "Opp draw 2 cards" */
export function choiceLabel(buttonText: string): string {
  const raw = buttonText.replace(/^Choice\./, '');
  const words = raw
    .replace(/([a-z])([A-Z0-9])/g, '$1 $2')
    .replace(/([0-9])([A-Za-z])/g, '$1 $2')
    .toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

const EFFECT_LABELS: Record<string, string> = {
  DonTap: 'paga DON', TrashSelf: 'scarta questa carta', DrawCards: 'pesca', TrashCard: 'scarta', KOCard: 'K.O.', SendToHand: 'in mano',
  SendToDeckBottom: 'in fondo al mazzo', SendToDeckTop: 'in cima al mazzo', BuffPower: 'potenza', BuffCombatPower: 'potenza in battaglia',
  DeployCharacter: 'gioca', DeploySelf: 'gioca questa carta', AttachRestedDon: 'dai DON riposato', AttachActiveDon: 'dai DON attivo',
  Rest: 'riposa', Activate: 'raddrizza', DonMinus: 'DON!! −', GainActiveDon: 'aggiungi DON attivo', GainRestedDon: 'aggiungi DON riposato',
  SendToTopLife: 'in cima alle vite', SendToBottomLife: 'in fondo alle vite', Heal: 'aggiungi vita', TakeTopLife: 'prendi vita',
  MillDeck: 'scarta dal mazzo', Freeze: 'non si raddrizza', Silence: 'nega effetti', ChangeCost: 'costo', CantAttack: 'non può attaccare',
};

export function stepLabel(effect: Record<string, unknown> | undefined): string {
  if (!effect) return '';
  return Object.entries(effect)
    .filter(([, v]) => v)
    .map(([k, v]) => {
      const l = EFFECT_LABELS[k];
      if (!l) return null;
      return typeof v === 'number' && v !== 1 ? `${l} ${v > 0 && k.startsWith('Buff') ? '+' : ''}${v}` : l;
    })
    .filter(Boolean)
    .join(', ');
}

export function cardName(db: Db, s: GameState, uid: number): string {
  if (uid < 0) return uid <= -1000 ? `DON su ${cardName(db, s, -1000 - uid)}` : uid % 2 ? 'DON attivo' : 'DON riposato';
  const f = findCard(s, uid);
  return f ? db[f.inst.id].name : '?';
}

/** One line describing the decision the prompt asks for. */
export function describePrompt(db: Db, s: GameState): string {
  const pr = s.prompt;
  if (!pr) return s.battle ? 'Battaglia' : 'Fase principale';
  const act = s.stack[s.stack.length - 1];
  const src = act ? db[act.cardId]?.name : '';
  const step = act ? abilityOf(db, act)?.steps[act.stepIdx] : undefined;
  switch (pr.kind) {
    case 'mulligan':
      return 'Tieni la mano o rimescola?';
    case 'block':
      return 'Blocchi con un [Blocker]?';
    case 'counter':
      return 'Usi un Counter?';
    case 'trigger':
      return `Attivi il [Trigger] di ${cardName(db, s, pr.uid)}?`;
    case 'confirm':
      return `${src}: attivi l'effetto?${step ? ' (' + stepLabel(step.effect) + ')' : ''}`;
    case 'choice':
      return `${src}: scegli un'opzione`;
    case 'declare':
      return `${src}: dichiara un numero`;
    case 'select': {
      const what = stepLabel(step?.effect) || 'scegli';
      const n = pr.min === pr.max ? `${pr.max}` : `${pr.min}–${pr.max}`;
      return `${src}: ${what} — scegli ${n} (${pr.chosen.length} scelti)`;
    }
  }
}

export function actionLabel(db: Db, s: GameState, a: Action): string {
  const n = (u: number) => cardName(db, s, u);
  switch (a.type) {
    case 'mulligan':
      return a.redraw ? 'Rimescola' : 'Tieni';
    case 'play':
      return `Gioca ${n(a.uid)}`;
    case 'activate':
      return `Attiva ${n(a.uid)}`;
    case 'attachDon':
      return `${a.n} DON a ${n(a.target)}`;
    case 'attack':
      return `${n(a.attacker)} attacca ${n(a.target)}`;
    case 'endTurn':
      return 'Fine turno';
    case 'block':
      return a.blocker === null ? 'Non bloccare' : `Blocca con ${n(a.blocker)}`;
    case 'counter':
      return a.uid === null ? 'Nessun counter' : `Counter: ${n(a.uid)}`;
    case 'trigger':
      return a.use ? 'Attiva il Trigger' : 'Prendi in mano';
    case 'pick':
      return n(a.uid);
    case 'done':
      return 'Conferma';
    case 'cancel':
      return 'Annulla';
    case 'choose': {
      const pr = s.prompt;
      if (pr?.kind === 'choice') return choiceLabel(pr.options[a.idx]);
      return String(a.idx);
    }
    case 'confirm':
      return a.yes ? 'Sì' : 'No';
  }
}
