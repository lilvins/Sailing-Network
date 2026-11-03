/**
 * Coach hints — turn the Pro's own thoughts into a sentence a human can read.
 *
 * This is a NARRATOR, not a player: `buildHint` receives the candidates the
 * search already scored and never decides anything. The winner is
 * `thoughts[0]`, the move it beat is `thoughts[1]`; every "why" is measured
 * on the real state (DON!! left, power margin, cost of the card that dies),
 * never guessed. Port of optcgwebsim's hc()/Tq(), minus the socket: the
 * payload the server used to send is rebuilt here from the search.
 *
 * `marks` are seat-relative data (see marks.ts for the projection to screen).
 * Pure: no DOM, no store, no I/O.
 */
import type { PlayerIntent } from "../engine/intents";
import type { AutoGameState, AutoPlayerState, CardDb, EngineCard, Iid, PID } from "../engine/state";
import { effectiveCost, effectivePower, keywordsOf, opponentOf } from "../engine/state";
import { cardValue } from "../ai/greedy";
import type { Thought } from "../ai/pro";

/** A card the board should light up. `role` says why it is lit. */
export type Mark = { owner: PID; iid: Iid; role: "source" | "target" | "victim" };

export type Hint = {
  /** Imperative headline naming the card. */
  headline: string;
  /** Short move label for the chip. */
  chip: string;
  /** Verb in -ndo, for the chip's second half. */
  gerund: string;
  /** Measured reason the move beats the alternative. */
  why: string;
  /** The alternative, with both values — null when there was nothing to compare. */
  note: string | null;
  marks: Mark[];
  move: PlayerIntent;
  /** Rollout value of the move and of the alternative (raw evaluation points). */
  value: number;
  altValue: number | null;
};

type Ctx = {
  db: CardDb;
  state: AutoGameState;
  pid: PID;
  me: AutoPlayerState;
  opp: PID;
  alt: PlayerIntent | null;
};

/** Evaluation points per "point of ten": a hand card is 6, a Life near the end ~150. */
const SCALE = 150;

/** Raw evaluation to a 0..10 scale, for the note. Exported for line.ts. */
export function toTen(mean: number): number {
  return Math.max(0, Math.min(10, Math.round(5 + 5 * Math.tanh(mean / SCALE))));
}

const nameOf = (db: CardDb, state: AutoGameState, owner: PID, iid: Iid): string => {
  const inst = state.players[owner].instances[iid];
  return inst ? (db(inst.cardId).name ?? inst.cardId) : "?";
};

const cardOf = (db: CardDb, state: AutoGameState, owner: PID, iid: Iid): EngineCard => db(state.players[owner].instances[iid].cardId);

const costOf = (db: CardDb, state: AutoGameState, owner: PID, iid: Iid): number => cardOf(db, state, owner, iid).cost ?? 0;

/** Who holds the card: a target prompt can name either side's. */
const ownerOf = (ctx: Ctx, iid: Iid): PID => (ctx.state.players[ctx.pid].instances[iid] ? ctx.pid : ctx.opp);

/**
 * The hint for the current decision, or null when the search returned nothing
 * (no searched options: a target prompt, a peek, a number — those go to the
 * greedy and have no thoughts to narrate).
 */
export function buildHint(db: CardDb, state: AutoGameState, pid: PID, thoughts: Thought[]): Hint | null {
  if (!thoughts.length) return null;
  const chosen = thoughts[0];
  const ctx: Ctx = { db, state, pid, me: state.players[pid], opp: opponentOf(state, pid), alt: thoughts[1]?.intent ?? null };
  const said = describe(ctx, chosen.intent);
  const altValue = thoughts[1]?.mean ?? null;
  return {
    headline: said.headline,
    chip: said.chip,
    gerund: said.gerund,
    why: why(ctx, chosen.intent),
    note: altValue === null || !thoughts[1]
      ? null
      : `In alternativa ${short(ctx, thoughts[1].intent)} — ${toTen(altValue)} su 10 contro ${toTen(chosen.mean)}.`,
    marks: marksOf(ctx, chosen.intent),
    move: chosen.intent,
    value: chosen.mean,
    altValue,
  };
}

// ---------------------------------------------------------------------------
// Headline / chip / gerund, per intent

type Said = { headline: string; chip: string; gerund: string };

function describe(ctx: Ctx, intent: PlayerIntent): Said {
  const { db, state, pid } = ctx;
  const n = (owner: PID, iid: Iid) => nameOf(db, state, owner, iid);
  const cost = (owner: PID, iid: Iid) => costOf(db, state, owner, iid);

  switch (intent.type) {
    case "playCard": {
      const c = cost(pid, intent.iid);
      const over = intent.replaceIid ? ` su ${n(pid, intent.replaceIid)}` : "";
      return { headline: `Cala ${n(pid, intent.iid)}${over}`, chip: `costo ${c}`, gerund: "calando" };
    }
    case "giveDon": {
      const now = (ctx.me.don.given[intent.targetIid] ?? 0) + 1;
      return { headline: `Dai 1 DON a ${n(pid, intent.targetIid)}`, chip: `${now} DON`, gerund: "caricando DON" };
    }
    case "attack": {
      const face = intent.targetIid === state.players[ctx.opp].leaderIid;
      return face
        ? { headline: `Attacca la faccia con ${n(pid, intent.attackerIid)}`, chip: "faccia", gerund: "attaccando" }
        : { headline: `Attacca ${n(ctx.opp, intent.targetIid)} con ${n(pid, intent.attackerIid)}`, chip: "personaggio", gerund: "attaccando" };
    }
    case "activateMain":
      return { headline: `Attiva ${n(pid, intent.iid)}`, chip: "effetto", gerund: "attivando" };
    case "respondBlock":
      return intent.blockerIid
        ? { headline: `Blocca con ${n(pid, intent.blockerIid)}`, chip: "blocco", gerund: "bloccando" }
        : { headline: "Incassa il colpo", chip: "nessun blocco", gerund: "incassando" };
    case "useCounter":
      return { headline: `Usa ${n(pid, intent.cardIid)} come counter`, chip: `+${counterOf(ctx, intent.cardIid)}`, gerund: "counterando" };
    case "useCounterEvent":
      return { headline: `Gioca ${n(pid, intent.cardIid)} in counter`, chip: "counter event", gerund: "counterando" };
    case "passCounter":
      return { headline: "Passa il counter", chip: "nessuna carta", gerund: "passando" };
    case "respondTrigger":
      return intent.activate
        ? { headline: "Attiva il trigger", chip: "trigger", gerund: "attivando" }
        : { headline: "Manda il trigger nel trash", chip: "no trigger", gerund: "scartando" };
    case "respondMay":
      return intent.activate
        ? { headline: "Attiva l'effetto", chip: "opzionale", gerund: "attivando" }
        : { headline: "Rinuncia all'effetto", chip: "opzionale", gerund: "rinunciando" };
    case "respondReplace":
      return intent.use
        ? { headline: "Sostituisci", chip: "protezione", gerund: "sostituendo" }
        : { headline: "Tieni il replacement", chip: "protezione", gerund: "tenendo" };
    case "respondTargets":
      return { headline: `Bersaglia ${intent.iids.map((i) => n(ownerOf(ctx, i), i)).join(", ") || "niente"}`, chip: `${intent.iids.length} bersagli`, gerund: "bersagliando" };
    case "respondOption":
      return { headline: `Scegli l'opzione ${intent.index + 1}`, chip: "scelta", gerund: "scegliendo" };
    case "respondNumber":
      return { headline: `Dichiara ${intent.value}`, chip: "numero", gerund: "dichiarando" };
    case "respondPeek":
      return { headline: intent.take.length ? `Prendi ${intent.take.map((i) => n(pid, i)).join(", ")}` : "Lascia tutto in deck", chip: "peek", gerund: "guardando" };
    case "respondPayDon":
      return { headline: "Paga il costo", chip: `${intent.fromActive}+${intent.fromRested} DON`, gerund: "pagando" };
    case "respondArrangeLife":
      return { headline: "Sistema la Life", chip: "ordine", gerund: "sistemando" };
    case "respondMulligan":
      return intent.take
        ? { headline: "Cambia la mano", chip: "mulligan", gerund: "cambiando" }
        : { headline: "Tieni la mano", chip: "mulligan", gerund: "tenendo" };
    case "ackManual":
      return { headline: "Risolvi manualmente", chip: "manuale", gerund: "risolvendo" };
    case "concede":
      return { headline: "Concedi", chip: "resa", gerund: "concedendo" };
    case "endTurn":
      return { headline: "Chiudi il turno", chip: "fine turno", gerund: "chiudendo" };
  }
}

/** One-line version of a move, for the note. */
function short(ctx: Ctx, intent: PlayerIntent): string {
  const s = describe(ctx, intent);
  return s.headline.charAt(0).toLowerCase() + s.headline.slice(1);
}

const counterOf = (ctx: Ctx, iid: Iid): number => cardOf(ctx.db, ctx.state, ctx.pid, iid).counter ?? 0;

// ---------------------------------------------------------------------------
// Why: the strongest measured reason the move beats the alternative

function why(ctx: Ctx, intent: PlayerIntent): string {
  const { db, state, pid, opp } = ctx;
  const n = (owner: PID, iid: Iid) => nameOf(db, state, owner, iid);
  const power = (owner: PID, iid: Iid) => effectivePower(db, state, owner, iid);
  const oppLeader = state.players[opp].leaderIid;
  const alt = ctx.alt;

  switch (intent.type) {
    case "playCard": {
      const card = cardOf(db, state, pid, intent.iid);
      const left = ctx.me.don.active - effectiveCost(db, state, pid, intent.iid);
      if (intent.replaceIid) return `Sostituisce ${n(pid, intent.replaceIid)} (costo ${costOf(db, state, pid, intent.replaceIid)}): quel pezzo aveva già dato, questo no.`;
      if (alt?.type === "attack" || alt?.type === "giveDon") return "Sviluppare adesso vale più che attaccare: la board resta anche al turno dopo.";
      if (left >= 1) return `Ti lascia ${left} DON attivi, quindi puoi ancora counterare.`;
      if ((card.power ?? 0) >= power(opp, oppLeader)) return `È già in grado di raggiungere il Leader avversario.`;
      if ((card.cost ?? 0) >= 5) return `Un ${card.cost} è il pezzo che la curva aspetta.`;
      return "Sviluppa board, che il turno dopo è ancora tua.";
    }
    case "giveDon": {
      const after = power(pid, intent.targetIid) + 1000;
      const leader = power(opp, oppLeader);
      const margin = after - leader;
      if (margin >= 2000) return `Lo porta a ${after}: ${margin} sopra il Leader a ${leader}, una sola carta di counter non basta più.`;
      if (margin >= 0) return `Lo porta a ${after} contro il Leader a ${leader}: per fermarlo serve un counter da ${margin + 1000}.`;
      return `Lo porta a ${after}: mancano ${-margin} per il Leader a ${leader}.`;
    }
    case "attack": {
      const ap = power(pid, intent.attackerIid);
      const tp = power(opp, intent.targetIid);
      const margin = ap - tp;
      if (intent.targetIid === oppLeader) {
        if (margin >= 2000) return `Margine di ${margin}: servono almeno due carte per fermarla.`;
        if (margin < 0) return `Non passa da solo: ${ap} contro ${tp}, mancano ${-margin}.`;
        return `Colpisce la faccia, ${ap} contro ${tp}.`;
      }
      if (margin < 0) return `Non uccide ${n(opp, intent.targetIid)}: ${ap} contro ${tp}, mancano ${-margin}.`;
      const kws = keywordsOf(db, state, opp, intent.targetIid);
      const rested = state.players[opp].instances[intent.targetIid].rested;
      const bits = [`Uccide ${n(opp, intent.targetIid)} (costo ${costOf(db, state, opp, intent.targetIid)})`];
      if (rested) bits.push("ed è ristato, non può bloccare");
      if (kws.has("Blocker")) bits.push("ed è un bloccante");
      return `${bits.join(" ")}.`;
    }
    case "activateMain":
      return "L'effetto sposta la board senza spendere carte dalla mano.";
    case "respondBlock": {
      const b = state.battle;
      if (!b) return "Blocca l'attacco.";
      const atk = power(b.attackerOwner, b.attackerIid);
      if (!intent.blockerIid) {
        const blockers = state.pendingChoice?.kind === "blockWindow" ? state.pendingChoice.blockers : [];
        if (!blockers.length) return `Nessun bloccante regge ${atk}: non ce n'è uno attivo.`;
        const best = Math.max(...blockers.map((i) => power(pid, i)));
        if (best <= atk) return `Nessun bloccante regge ${atk}: il migliore è a ${best}, incassare costa meno che perdere il pezzo.`;
        return `Un bloccante a ${best} reggerebbe ${atk}, ma tenerlo attivo rende di più.`;
      }
      const held = power(pid, intent.blockerIid);
      if (held > atk) return `Blocca con ${held} contro ${atk}: regge e il colpo non passa.`;
      return `Blocca con ${held} contro ${atk}: perde il pezzo (costo ${costOf(db, state, pid, intent.blockerIid)}), ma il colpo non arriva al bersaglio.`;
    }
    case "useCounter": {
      const b = state.battle;
      if (!b) return "Alza la difesa.";
      const atk = power(b.attackerOwner, b.attackerIid);
      const after = power(pid, b.targetIid) + counterOf(ctx, intent.cardIid);
      if (after > atk) return `Porta il bersaglio a ${after} contro ${atk}: il colpo non passa.`;
      return `Porta il bersaglio a ${after} contro ${atk}: mancano ancora ${atk - after + 1000}.`;
    }
    case "useCounterEvent":
      return "L'evento counter copre il colpo senza perdere un personaggio.";
    case "passCounter": {
      const b = state.battle;
      if (!b) return "Nessun colpo da fermare: la mano resta per dopo.";
      const gap = Math.max(0, power(b.attackerOwner, b.attackerIid) - power(pid, b.targetIid) + 1000);
      const inHand = ctx.me.zones.hand.reduce((sum, i) => sum + counterOf(ctx, i), 0);
      if (inHand < gap) return `Per fermarlo servono ${gap} di counter, in mano ne hai ${inHand}: la mano resta per dopo.`;
      return `Per fermarlo servono ${gap} di counter e in mano ne hai ${inHand}, ma il bersaglio non vale le carte.`;
    }
    case "respondTrigger":
      return intent.activate ? "L'effetto del trigger vale più della carta che finisce nel trash." : "Il trigger non ripaga: la carta va nel trash.";
    case "respondMay":
      return intent.activate ? "L'effetto è disponibile e sposta la posizione a costo zero." : "L'effetto non aggiunge niente qui: si tiene il costo.";
    case "respondReplace":
      return intent.use ? "Il replacement protegge un pezzo che serve ancora." : "Il replacement si tiene per un pezzo più grosso.";
    case "respondTargets": {
      if (!intent.iids.length) return "Nessun bersaglio vale l'effetto: si rinuncia.";
      const said = intent.iids.map((i) => `${n(ownerOf(ctx, i), i)} (costo ${costOf(db, state, ownerOf(ctx, i), i)})`).join(", ");
      const pc = state.pendingChoice;
      if (intent.iids.length > 1 || pc?.kind !== "selectTargets") return `Bersaglia ${said}.`;
      const top = Math.max(...pc.candidates.map((c) => costOf(db, state, c.owner, c.iid)));
      const cost = costOf(db, state, ownerOf(ctx, intent.iids[0]), intent.iids[0]);
      return cost >= top
        ? `${said}: il più caro fra i ${pc.candidates.length} bersagli legali.`
        : `${said}: rende più del bersaglio più caro, che costa ${top}.`;
    }
    case "respondOption":
      return `L'opzione ${intent.index + 1} è quella che rende di più in questa posizione.`;
    case "respondNumber":
      return "Il numero dichiarato è quello che massimizza il risultato dell'effetto.";
    case "respondPeek":
      return intent.take.length ? "Prende i pezzi più costosi fra quelli visti." : "Nessun pezzo vale il rimescolamento: si lascia tutto.";
    case "respondPayDon":
      return "Paga dai DON già dati, così i DON attivi restano per giocare.";
    case "respondArrangeLife":
      return "L'ordine tiene in cima la carta che serve a sopravvivere.";
    case "respondMulligan":
      return intent.take ? "La mano non ha un'apertura: si cambia." : "La mano ha un'apertura e un pezzo di curva: si tiene.";
    case "ackManual":
      return "Il prompt va risolto a mano: il motore non ha una regola per questo caso.";
    case "concede":
      return "La posizione è persa: concedere risparmia tempo.";
    case "endTurn":
      return ctx.me.don.active
        ? `Non restano mosse che rendono: ${ctx.me.don.active} DON attivi restano per il counter.`
        : "Non restano mosse che rendono e i DON attivi sono finiti.";
  }
}

// ---------------------------------------------------------------------------
// Marks: what the board lights up

function marksOf(ctx: Ctx, intent: PlayerIntent): Mark[] {
  const { pid, opp } = ctx;
  switch (intent.type) {
    case "playCard":
      return [{ owner: pid, iid: intent.iid, role: "source" }, ...(intent.replaceIid ? [{ owner: pid, iid: intent.replaceIid, role: "victim" as const }] : [])];
    case "giveDon":
      return [{ owner: pid, iid: intent.targetIid, role: "source" }];
    case "activateMain":
      return [{ owner: pid, iid: intent.iid, role: "source" }];
    case "attack":
      return [{ owner: pid, iid: intent.attackerIid, role: "source" }, { owner: opp, iid: intent.targetIid, role: "target" }];
    case "respondBlock":
      return intent.blockerIid ? [{ owner: pid, iid: intent.blockerIid, role: "source" }] : [];
    case "useCounter":
      return [{ owner: pid, iid: intent.cardIid, role: "source" }, { owner: pid, iid: intent.targetIid, role: "target" }];
    case "useCounterEvent":
      return [{ owner: pid, iid: intent.cardIid, role: "source" }];
    case "respondTargets":
      return intent.iids.map((iid) => ({ owner: ownerOf(ctx, iid), iid, role: "target" as const }));
    case "respondPeek":
      return intent.take.map((iid) => ({ owner: pid, iid, role: "source" as const }));
    default:
      return [];
  }
}

/** Value of a card as the coach sees it — re-exported so callers do not import the AI. */
export { cardValue };