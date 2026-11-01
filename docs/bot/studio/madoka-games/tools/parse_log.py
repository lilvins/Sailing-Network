"""Step 3: trasforma log_lines.txt in un game record (eventi + stato per turno).

Uso: python -P parse_log.py OUT_DIR --video-id ID --title "..." [--json OUT.json] [--md OUT.md]

Formato del log di OPTCGSim (v1.42), visto nei video di madoka_hk:
  [You]/[Opponent] Leader is X [ID] | Chose to go First/Second | Draw N Card | Draw N Don
  Deploy X [ID] | Attach N Don to X [ID] (N Total) | X [ID] attacking Y [ID]
  X [ID][pow] vs Y [ID][pow] | Y [ID] hit for N damage | Attack Fails | X [ID] Destroyed
  Discard X [ID] for Counter N | Trash X [ID] | X [ID]: <effetto> | End Turn | Concedes!
"[You]" e' sempre madoka (registra lui).
"""
import argparse, json, os, re, sys
from difflib import get_close_matches

CARDS = r"C:\Users\Admin\Documents\GitHub\Sailing-Network-bot\public\data\cards.json"
DB = {c["id"]: c for c in json.load(open(CARDS, encoding="utf-8"))}

def name(cid):
    c = DB.get(cid)
    return c["name"].replace("&amp;", "&") if c else cid

def cat(cid):
    c = DB.get(cid)
    return c["category"] if c else "?"

ID_RE = re.compile(r"\[?\s*(OP|0P|Op|op|ST|St|st|S1|5T|EB|E8|PRB|P)\s*([0-9OoIl]{2})\s*[-_.~]?\s*([0-9OoIlJj]{3})\s*[\]\)jJlI1|}]?")

def fix_digits(s):
    return s.translate(str.maketrans("OoIlJj", "001100"))

def canon_ids(text, seen):
    def rep(m):
        p = m.group(1).upper().replace("0P", "OP").replace("S1", "ST").replace("5T", "ST").replace("E8", "EB")
        cid = f"{p}{fix_digits(m.group(2))}-{fix_digits(m.group(3))}"
        if cid not in DB:
            cand = get_close_matches(cid, list(seen) or list(DB), n=1, cutoff=0.75)
            if cand:
                cid = cand[0]
        seen.add(cid)
        return f"<{cid}>"
    return ID_RE.sub(rep, text)

def clean_players(s):
    s = re.sub(r"\[?\s*Y[oaO0]u[\]\)jlI1|}]", "[You]", s)
    s = re.sub(r"\[?\s*0?Opponent[\]\)jlI1|}]?", "[Opponent]", s)
    return s

P = r"\[(You|Opponent)\]"
I = r"<([A-Z]+\d{2}-\d{3})>"
N = r"[^<\[]*?"   # nome carta (senza spazi, puo' essere vuoto)
PATTERNS = [
    ("leader", P + r"Leaderis" + N + I),
    ("goes", P + r"Chosetogo(First|Second)"),
    ("draw", P + r"Draw([\dlI])Card"),
    ("don", P + r"Draw(\d+)Don"),
    ("deploy", P + r"De?pl?o?y" + N + I),
    ("attach", P + r"Attach(\d+)Donto" + N + I + r"\(?(\d+)?Total"),
    ("attack", P + N + I + r"attacking" + N + I),
    ("block", P + N + I + r"Blocks"),
    ("destroyed", P + N + I + r"Destroyed"),
    ("counter", P + r"Discard" + N + I + r"forCounter([0-9oOlI]+)"),
    ("trash", P + r"Trash" + N + I),
    ("endturn", P + r"EndTurn"),
    ("mulligan", P + r"Mulligan"),
    ("concede", P + r"Concede"),
    ("effect", P + N + I + r":?(.*?)(?=\[You\]|\[Opponent\]|AttackFails|[A-Za-z.&'\-]*<[A-Z]+\d{2}-\d{3}>\[\d+\]vs|[A-Za-z.&'\-]*<[A-Z]+\d{2}-\d{3}>hitfor|###|$)"),
    ("battle", I + r"\[(\d+)\]vs" + N + I + r"\[(\d+)\]"),
    ("hit", I + r"hitfor(\d+)damage"),
    ("fail", r"AttackFails"),
]
BIG = re.compile("|".join(f"(?P<{k}>{p})" for k, p in PATTERNS))
GROUPS = {}
for k, p in PATTERNS:
    GROUPS[k] = re.compile(p)

def parse(lines):
    seen = set()
    raw, rmap = "", []
    for t, l in lines:
        # versioni del sim con il nome utente al posto di [You]/[Opponent]
        l = re.sub(r"\[?\s*([A-Za-z0-9_ .]{2,24})\s*#\s*\d{3,5}\s*[\]\)jlI1|}]",
                   lambda m: "[You]" if "madoka" in m.group(1).lower().replace(" ", "") else "[Opponent]", l)
        seg = ("###" + ("oncede###" if "oncede" in l else "")) if l.startswith("###") else l.replace(" ", "")
        raw += seg
        rmap += [t] * len(seg)
    # canonicalizza gli ID sul testo gia' unito (gli ID spezzati a capo si ricompongono)
    buf, tmap, last = "", [], 0
    for m in ID_RE.finditer(raw):
        buf += raw[last:m.start()]; tmap += rmap[last:m.start()]
        tok = canon_ids(m.group(0), seen)
        buf += tok; tmap += [rmap[m.start()]] * len(tok)
        last = m.end()
    buf += raw[last:]; tmap += rmap[last:]
    # pulizia nomi giocatore (stessa lunghezza non garantita: ricalcola mappa grossolanamente)
    cleaned = clean_players(buf)
    if len(cleaned) != len(buf):
        ratio = len(tmap) / max(1, len(cleaned))
        tmap = [tmap[min(len(tmap) - 1, int(i * ratio))] for i in range(len(cleaned))]
    buf = cleaned
    evs = []
    covered, last, leftovers = 0, 0, []
    for m in BIG.finditer(buf):
        gap = buf[last:m.start()]
        if len(gap.replace("###", "")) > 12:
            leftovers.append((tmap[last] if last < len(tmap) else 0, gap))
        covered += m.end() - m.start(); last = m.end()
        k = m.lastgroup
        g = GROUPS[k].fullmatch(m.group(0)) or GROUPS[k].match(m.group(0))
        evs.append({"t": tmap[m.start()], "type": k, "g": list(g.groups()) if g else []})
    parse.stats = {"chars": len(buf), "covered": covered, "leftovers": leftovers,
                   "ids_unknown": sorted(x for x in seen if x not in DB)}
    return evs, buf

def build(evs, meta):
    leaders, first = {}, None
    life, don, field, stage = {}, {"You": 0, "Opponent": 0}, {"You": [], "Opponent": []}, {"You": None, "Opponent": None}
    turns, cur = [], None
    owner_of_leader = {}
    pending_attack = None
    unknown = 0

    def new_turn(pl):
        nonlocal cur
        cur = {"turn": len(turns) + 1, "player": pl, "events": []}
        turns.append(cur)

    def emit(e):
        if cur is None:
            new_turn(e.get("player") or "You")
        cur["events"].append(e)

    for ev in evs:
        k, g, t = ev["type"], ev["g"], ev["t"]
        if k == "leader":
            leaders[g[0]] = g[1]; owner_of_leader[g[1]] = g[0]
            life[g[0]] = (DB.get(g[1]) or {}).get("cost") or 5
            continue
        if k == "goes":
            first = g[0] if g[1] == "First" else ("You" if g[0] == "Opponent" else "Opponent")
            continue
        pl = g[0] if g and g[0] in ("You", "Opponent") else None
        if k == "mulligan":
            meta.setdefault("mulligan", {})[pl] = True
            continue
        if cur is None:
            # il primo turno parte solo dal primo "Draw ... Don" (scarta la spazzatura del pre-partita)
            if k != "don":
                continue
            new_turn(first or pl)
        if k == "draw":
            if not cur["events"] and pl != cur["player"]:
                pass
            emit({"t": t, "type": "draw", "player": pl, "n": int(fix_digits(g[1]))})
        elif k == "don":
            don[pl] += int(g[1])
            emit({"t": t, "type": "don", "player": pl, "n": int(g[1]), "don_total": don[pl]})
        elif k == "deploy":
            cid = g[1]; c = cat(cid)
            if c == "Stage":
                stage[pl] = cid
            elif c == "Character":
                field[pl].append(cid)
            emit({"t": t, "type": "play", "player": pl, "card": cid, "name": name(cid), "category": c})
        elif k == "attach":
            emit({"t": t, "type": "attach_don", "player": pl, "n": int(g[1]), "to": g[2], "to_name": name(g[2]),
                  "total_on_card": int(g[3]) if g[3] else None})
        elif k == "attack":
            pending_attack = {"t": t, "type": "attack", "player": pl, "attacker": g[1], "attacker_name": name(g[1]),
                              "target": g[2], "target_name": name(g[2]), "counters": [], "result": None}
            emit(pending_attack)
        elif k == "block":
            if pending_attack is not None:
                pending_attack["blocker"] = g[1]; pending_attack["blocker_name"] = name(g[1])
            continue
        elif k == "counter":
            e = {"t": t, "type": "counter", "player": pl, "card": g[1], "name": name(g[1]), "value": int(fix_digits(g[2]))}
            emit(e)
            if pending_attack is not None:
                pending_attack["counters"].append({"player": pl, "card": g[1], "value": int(fix_digits(g[2]))})
        elif k == "battle":
            if pending_attack is not None:
                pending_attack["attack_power"] = int(g[1]); pending_attack["defense_power"] = int(g[3])
        elif k == "hit":
            cid = g[0]
            o = owner_of_leader.get(cid)
            if pending_attack is not None and pending_attack.get("target") == cid and pending_attack.get("player"):
                # chi subisce e' l'avversario di chi attacca (necessario nei mirror, stesso leader)
                o = "Opponent" if pending_attack["player"] == "You" else "You"
            if o:
                life[o] -= int(g[1])
            if pending_attack is not None:
                pending_attack["result"] = "hit"
            emit({"t": t, "type": "damage", "player": o, "leader": cid, "n": int(g[1]), "life_after": life.get(o)})
        elif k == "fail":
            if pending_attack is not None:
                pending_attack["result"] = "fail"
        elif k == "destroyed":
            cid = g[1]
            if cid in field[pl]:
                field[pl].remove(cid)
            if pending_attack is not None and cid in (pending_attack["target"], pending_attack.get("blocker")):
                pending_attack["result"] = "ko"
            emit({"t": t, "type": "ko", "player": pl, "card": cid, "name": name(cid)})
        elif k == "trash":
            cid = g[1]
            where = "hand"
            if cid in field[pl] and cur and cur["player"] == pl:
                field[pl].remove(cid); where = "field"
            emit({"t": t, "type": "trash", "player": pl, "card": cid, "name": name(cid), "from": where})
        elif k == "effect":
            cid, txt = g[1], g[2]
            e = {"t": t, "type": "effect", "player": pl, "card": cid, "name": name(cid), "text": txt}
            m3 = re.match(r"(?:Return|Send)" + N + I + r"to(Hand|Deck|Bottom)", txt)
            if m3:
                rc = m3.group(1) if m3.lastindex == 2 else m3.group(1)
                for p_ in ("You", "Opponent"):
                    if rc in field[p_]:
                        field[p_].remove(rc); break
                e["type"] = "bounce"
            if re.search(r"Add\w*card\w*toto?p?ofLife", txt, re.I):
                life[pl] = (life.get(pl) or 0) + 1
                e["type"] = "life_gain"; e["life_after"] = life[pl]
            m5 = re.match(r"(?:Destroy|KO|K\.O\.)" + N + I, txt)
            if m5:
                dc = m5.group(1)
                for p_ in ("Opponent" if pl == "You" else "You", pl):
                    if dc in field[p_]:
                        field[p_].remove(dc); break
                e["type"] = "effect_ko"
            m4 = re.match(r"Trash" + N + I, txt)
            if m4 and m4.group(1) == cid and cid in field[pl]:
                # la carta si scarta da sola dal campo (es. Kid & Killer ST24-002)
                field[pl].remove(cid)
                e["type"] = "self_trash"
            m2 = re.match(r"De?pl?o?y" + N + I, txt)
            if m2:   # personaggio giocato da un effetto (es. Mihawk ST32-003 -> Perona)
                pc = m2.group(1)
                if cat(pc) == "Character":
                    field[pl].append(pc)
                elif cat(pc) == "Stage":
                    stage[pl] = pc
                e = {"t": t, "type": "play", "player": pl, "card": pc, "name": name(pc), "category": cat(pc),
                     "via": f"{cid} {name(cid)}"}
            if cat(cid) == "Event" and "ActivateCounter" in txt:
                e["type"] = "event_counter"
            elif cat(cid) == "Event" and "ActivateTrigger" in txt:
                e["type"] = "trigger"
            if cur and cur["events"]:
                last = cur["events"][-1]
                # effetti ripetuti identici (es. "Activate 1 Don" x3) -> conteggio
                if last.get("type") == e["type"] and last.get("card") == cid and last.get("text") == txt:
                    last["times"] = last.get("times", 1) + 1
                    continue
            emit(e)
        elif k == "mulligan":
            mull = meta.setdefault("mulligan", {}); mull[pl] = True
            continue
        elif k == "endturn":
            emit({"t": t, "type": "end_turn", "player": pl})
            cur["board_end"] = {"life": dict(life), "don_total": dict(don),
                                "field": {p: [f"{x} {name(x)}" for x in v] for p, v in field.items()},
                                "stage": {p: (f"{v} {name(v)}" if v else None) for p, v in stage.items()}}
            nxt = "Opponent" if pl == "You" else "You"
            new_turn(nxt)
        elif k == "concede":
            emit({"t": t, "type": "concede", "player": pl})
            cur["board_end"] = {"life": dict(life), "don_total": dict(don),
                                "field": {p: [f"{x} {name(x)}" for x in v] for p, v in field.items()},
                                "stage": {p: (f"{v} {name(v)}" if v else None) for p, v in stage.items()}}
    # rimuovi turni vuoti finali
    turns = [t for t in turns if t["events"]]
    winner = None
    for t in turns:
        for e in t["events"]:
            if e["type"] == "concede":
                winner = "You" if e["player"] == "Opponent" else "Opponent"
    end_note = None
    if winner is None:
        for p, v in life.items():
            if v is not None and v < 0:
                winner = "You" if p == "Opponent" else "Opponent"
                end_note = "colpo al leader a 0 vite"
    if winner is None and turns:
        # video che finisce subito dopo un colpo al leader a 0 vite (o quasi): vittoria probabile
        lastdmg = [e for e in turns[-1]["events"] if e["type"] == "damage"]
        if lastdmg and (lastdmg[-1].get("life_after") or 0) <= 0:
            p = lastdmg[-1]["player"]
            winner = "You" if p == "Opponent" else "Opponent"
            end_note = "probabile: il video si chiude dopo un colpo al leader senza vite (conteggio vite da OCR)"
    return {
        **meta,
        "source": "OCR del combat log di OPTCGSim visibile nel video (non sottotitoli)",
        "you": "madoka_hk",
        "leaders": {p: {"id": v, "name": name(v)} for p, v in leaders.items()},
        "first_player": first,
        "winner": winner,
        "end": "concede" if any(e["type"] == "concede" for t in turns for e in t["events"]) else (end_note or "fine video / non chiaro"),
        "turns": turns,
    }

def short(e):
    who = "madoka" if e.get("player") == "You" else "avv."
    k = e["type"]
    if k == "draw": return None
    if k == "don": return f"+{e['n']} DON!! (tot {e['don_total']})"
    if k == "play": return f"gioca {e['name']} [{e['card']}]"
    if k == "attach_don": return f"{e['n']} DON!! su {e['to_name']}"
    if k == "attack":
        c = "".join(f", counter {x['value']} ({name(x['card'])})" for x in e["counters"])
        pw = f" {e.get('attack_power','?')} vs {e.get('defense_power','?')}" if "attack_power" in e else ""
        bl = f" (blocca {e['blocker_name']})" if e.get("blocker") else ""
        return f"ATTACCO {e['attacker_name']} -> {e['target_name']}{bl}{pw}{c} => {e['result'] or '?'}"
    if k == "counter": return None
    if k == "damage": return f"  {e['leader']} perde 1 vita (vite {e['life_after']})"
    if k == "ko": return f"  K.O. {e['name']} ({'madoka' if e['player']=='You' else 'avv.'})"
    if k == "trash": return f"scarta {e['name']} ({'dal campo' if e['from']=='field' else 'dalla mano'})"
    if k == "event_counter": return f"  [{who}] counter evento {e['name']}"
    if k == "trigger": return f"  [{who}] trigger {e['name']}"
    if k == "effect":
        x = f" x{e['times']}" if e.get("times") else ""
        return f"effetto {e['name']}: {e['text'][:70]}{x}"
    if k == "end_turn": return None
    if k == "effect_ko": return f"effetto {e['name']}: K.O. ({e['text'][:50]})"
    if k == "self_trash": return f"{e['name']} si scarta dal campo"
    if k == "bounce": return f"effetto {e['name']}: rimanda in mano/mazzo ({e['text'][:50]})"
    if k == "life_gain": return f"effetto {e['name']}: +1 vita (vite {e['life_after']})"
    if k == "concede": return f"{who} CONCEDE"
    return k

def to_md(rec):
    L = [f"### {rec['video_id']} — {rec.get('title','')}", "",
         f"- Leader: madoka {rec['leaders'].get('You',{}).get('name')} vs avv. {rec['leaders'].get('Opponent',{}).get('name')} "
         f"({rec['leaders'].get('Opponent',{}).get('id')}); primo: {'madoka' if rec['first_player']=='You' else 'avversario'}; "
         f"vincitore: {'madoka' if rec['winner']=='You' else ('avversario' if rec['winner'] else '?')} ({rec['end']})", ""]
    for t in rec["turns"]:
        who = "madoka" if t["player"] == "You" else "avv."
        acts = [s for s in (short(e) for e in t["events"]) if s]
        L.append(f"**T{t['turn']} {who}** — " + "; ".join(acts))
        for h in t.get("hand_you", []):
            if h["when"] == "inizio" and h["n"] == 0:
                L.append("  - mano madoka a inizio turno: non visibile nel fotogramma")
            elif h["when"] == "inizio":
                L.append(f"  - mano madoka a inizio turno (riconoscimento immagini, {h['n']} carte): "
                         + ", ".join(c.split(" ", 1)[1] for c in h["cards"]))
        b = t.get("board_end")
        if b:
            L.append(f"  - fine turno: vite madoka {b['life'].get('You')} / avv. {b['life'].get('Opponent')}; "
                     f"campo madoka: {', '.join(x.split(' ',1)[1] for x in b['field']['You']) or '-'}; "
                     f"campo avv.: {', '.join(x.split(' ',1)[1] for x in b['field']['Opponent']) or '-'}")
    return "\n".join(L) + "\n"

if __name__ == "__main__" and len(sys.argv) > 1 and sys.argv[1] == "md":
    # rigenera il riassunto da un game json (es. dopo hand_rec): parse_log.py md game.json out.md
    rec = json.load(open(sys.argv[2], encoding="utf-8"))
    open(sys.argv[3], "w", encoding="utf-8").write(to_md(rec))
    raise SystemExit

if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("d"); ap.add_argument("--video-id", required=True); ap.add_argument("--title", default="")
    ap.add_argument("--json"); ap.add_argument("--md")
    a = ap.parse_args()
    lines = []
    for l in open(os.path.join(a.d, "log_lines.txt"), encoding="utf-8"):
        t, txt = l[:8], l[10:].rstrip("\n")
        lines.append((float(t), txt))
    evs, buf = parse(lines)
    open(os.path.join(a.d, "log_flat.txt"), "w", encoding="utf-8").write(buf)
    if not any(e["type"] == "concede" for e in evs) and "oncede" in buf[-600:]:
        # riga "X Concedes!" coperta dal popup di fine partita: chi concede non e' leggibile;
        # assumiamo chi sta subendo il turno (verificato a occhio sui video del pilota)
        last_pl = next((e["g"][0] for e in reversed(evs) if e["g"] and e["g"][0] in ("You", "Opponent")
                        and e["type"] in ("attack", "endturn", "deploy", "attach")), None)
        if last_pl:
            evs.append({"t": evs[-1]["t"], "type": "concede", "g": ["Opponent" if last_pl == "You" else "You"]})
    rec = build(evs, {"video_id": a.video_id, "url": f"https://www.youtube.com/watch?v={a.video_id}", "title": a.title})
    st = parse.stats
    rec["quality"] = {"log_chars": st["chars"], "parsed_fraction": round(st["covered"] / max(1, st["chars"]), 3),
                      "unparsed_fragments": [f"{t:.0f}s {g}" for t, g in st["leftovers"]],
                      "unknown_ids": st["ids_unknown"],
                      "log_gaps": sum(1 for _, l in lines if l.startswith("###"))}
    jp = a.json or os.path.join(a.d, "game.json")
    json.dump(rec, open(jp, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    md = to_md(rec)
    open(a.md or os.path.join(a.d, "game.md"), "w", encoding="utf-8").write(md)
    print(md)
