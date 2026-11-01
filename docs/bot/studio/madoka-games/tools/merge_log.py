"""Step 2: unisce le finestre OCR (ocr_frames.json) in un unico log testuale.

Uso: python -P merge_log.py OUT_DIR
Scrive OUT_DIR/log_lines.txt (righe visive, con il secondo del video in cui compaiono).

Ogni fotogramma mostra le ultime ~14 righe del log. Si cerca la sovrapposizione
massima fra la coda del log accumulato e l'inizio della finestra nuova
(confronto fuzzy, spazi ignorati) e si aggiungono solo le righe nuove.
- la coda accumulata puo' terminare con 1-3 righe "spazzatura" (riga a meta'
  durante lo scorrimento, es. "Youl"): se la sovrapposizione si trova solo
  scartandole, vengono cancellate;
- una finestra senza alcuna sovrapposizione (popup sopra il log, scroll manuale)
  viene messa in attesa e accettata solo se la successiva la conferma.
- il log parte solo dalla prima finestra che contiene "Leader is" o "[You]".
"""
import os, re, sys, json
from difflib import SequenceMatcher

def norm(s):
    s = s.lower().replace(" ", "")
    return re.sub(r"[^a-z0-9\[\]\-:]", "", s)

def sim(a, b):
    a, b = norm(a), norm(b)
    if not a or not b:
        return 0.0
    return SequenceMatcher(None, a, b).ratio()

# finestra "OPBounty" che madoka a volte ha sopra il log (inizio/fine partita, a volte a meta')
OVERLAY = ("deadoralive", "bounty", "million", "closetheapp", "squelch", "squetch", "awaitforthematch")

def is_overlay(fr):
    t = norm(" ".join(l["text"] for l in fr["lines"]))
    return any(k in t for k in OVERLAY)

def window(fr):
    ls = [l for l in fr["lines"] if l["score"] >= 0.5]
    if ls and ls[0]["y"] < 8:   # riga in alto tagliata a meta'
        ls = ls[1:]
    rows = []
    for l in ls:
        if rows and abs(l["y"] - rows[-1]["y"]) < 12:
            rows[-1]["text"] += " " + l["text"]
            rows[-1]["score"] = min(rows[-1]["score"], l["score"])
        else:
            rows.append(dict(l))
    return [r["text"] for r in rows], [r["score"] for r in rows]

def overlap(L, W, max_junk=3, max_skip=2):
    """ritorna (o, skip, junk): L[:len-junk][-o:] ~ W[skip:skip+o]; massimizza o"""
    best = (0, 0, 0)
    for junk in range(0, max_junk + 1):
        Lj = L[:len(L) - junk] if junk else L
        for skip in range(0, max_skip + 1):
            for o in range(min(len(Lj), len(W) - skip), best[0], -1):
                # tollera qualche riga letta male (1 ogni 4) purche' la prima e l'ultima combacino
                bad = 0
                for i in range(o):
                    if sim(Lj[len(Lj) - o + i], W[skip + i]) < 0.8:
                        bad += 1
                        if bad > o // 4 or i == 0 or i == o - 1:
                            bad = 99
                            break
                if bad <= o // 4:
                    best = (o, skip, junk)
                    break
    return best

def merge(frames):
    L, T, S = [], [], []
    pending = None
    jumps = 0
    started = False
    concede_seen = None
    for fr in frames:
        if is_overlay(fr):
            if started and any("concede" in norm(l["text"]) for l in fr["lines"]):
                concede_seen = fr["t"]
            continue
        W, WS = window(fr)
        if len(W) < 3:
            continue
        if not started:
            if any(("leaderis" in norm(w)) or ("[you]" in norm(w)) or ("madoka" in norm(w)) for w in W):
                started = True
                L, T, S = W[:], [fr["t"]] * len(W), WS[:]
            continue
        o, skip, junk = overlap(L[-40:], W)
        if o >= 3 or (o >= 1 and o >= len(W) - skip - 2):
            if junk:
                del L[-junk:]; del T[-junk:]; del S[-junk:]
            # rilettura migliore di una riga gia' acquisita: sostituiscila
            for i in range(o):
                j = len(L) - o + i
                if WS[skip + i] > S[j] + 0.02:
                    L[j], S[j] = W[skip + i], WS[skip + i]
            new = W[skip + o:]
            L += new; T += [fr["t"]] * len(new); S += WS[skip + o:]
            pending = None
            continue
        # finestra vecchia (scroll all'indietro / ridisegno): tutte le righe gia' viste
        if sum(any(sim(w, x) >= 0.8 for x in L[-80:]) for w in W) >= len(W) - 1:
            continue
        if pending is not None:
            po, ps, _ = overlap(pending[1], W, max_junk=3)
            if po >= 3:
                # la finestra in attesa e' confermata: aggancia la parte che non c'e' gia'
                P = pending[1]
                o2, s2, j2 = overlap(L[-40:], P, max_skip=len(P) - 1)
                if j2:
                    del L[-j2:]; del T[-j2:]; del S[-j2:]
                if o2 == 0:
                    jumps += 1
                    L.append("### SALTO: righe mancanti ###"); T.append(pending[0]); S.append(1.0)
                add = P[s2 + o2:]
                L += add; T += [pending[0]] * len(add); S += pending[2][s2 + o2:]
                o3, s3, j3 = overlap(L[-40:], W)
                if j3:
                    del L[-j3:]; del T[-j3:]; del S[-j3:]
                new = W[s3 + o3:]
                L += new; T += [fr["t"]] * len(new); S += WS[s3 + o3:]
                pending = None
                continue
        pending = (fr["t"], W, WS)
    if concede_seen is not None and not any("concede" in norm(x) for x in L[-5:]):
        L.append("### CONCEDE letto sotto il popup (giocatore non leggibile) Concedes ###"); T.append(concede_seen)
    return L, T, jumps

if __name__ == "__main__":
    d = sys.argv[1]
    frames = json.load(open(os.path.join(d, "ocr_frames.json"), encoding="utf-8"))
    L, T, jumps = merge(frames)
    with open(os.path.join(d, "log_lines.txt"), "w", encoding="utf-8") as f:
        for t, l in zip(T, L):
            f.write(f"{t:8.2f}  {l}\n")
    print("righe:", len(L), "salti:", jumps)
