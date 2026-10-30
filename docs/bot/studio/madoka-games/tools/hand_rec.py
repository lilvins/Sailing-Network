"""Step 3 (facoltativo): riconosce la mano di madoka (striscia in basso a sinistra).

Uso: python -P hand_rec.py VIDEO.mp4 OUT_DIR --pool OP14-020,ST32-003,...  [--fps 1]

Le carte della mano sono in fila da x=83 (video 1280x720), alte ~92 px,
larghe ~66 px; con molte carte si sovrappongono e se ne vede solo la parte
sinistra. Per ogni numero di carte n plausibile si tagliano le n fette e si
confronta ogni fetta con le immagini di riferimento OPTCGSim del pool
(correlazione normalizzata); si tiene l'n con punteggio medio migliore.
Scrive OUT_DIR/hand.json: [{t, n, cards:[id], scores:[...]}]
"""
import argparse, glob, json, os, subprocess, sys
import cv2, numpy as np

REF = r"C:\Users\Admin\Desktop\Builds_Windows\OPTCGSim_Data\StreamingAssets\Cards"
X0, Y0, Y1 = 83, 598, 690
CW, CH = 66, 92
XMAX = 430

def load_refs(pool, cw=CW, ch=CH):
    refs = {}
    for cid in pool:
        s = cid.split("-")[0]
        p = os.path.join(REF, s, cid + ".jpg")
        if not os.path.exists(p):
            p = os.path.join(REF, s, cid + ".png")
        if os.path.exists(p):
            im = cv2.imread(p)
            refs[cid] = cv2.resize(im, (cw, ch), interpolation=cv2.INTER_AREA)
    return refs

def wood_mask(img):
    hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)
    hue, sat = hsv[:, :, 0], hsv[:, :, 1]
    return (hue > 5) & (hue < 25) & (sat > 60)

def detect_geom(frames):
    """posizione della striscia della mano (varia fra le versioni/layout del video):
    righe e colonne non 'legno' nella zona in basso a sinistra; mediana su piu' fotogrammi"""
    ys0, ys1, xs0, xs1 = [], [], [], []
    for fr in frames:
        reg = fr[540:716, 30:470]
        nw = ~wood_mask(reg)
        rows = np.where(nw.mean(axis=1) > 0.25)[0]
        if len(rows) < 40:
            continue
        # blocco contiguo piu' lungo di righe
        runs, st = [], rows[0]
        for a, b in zip(rows, rows[1:]):
            if b != a + 1:
                runs.append((st, a)); st = b
        runs.append((st, rows[-1]))
        y0, y1 = max(runs, key=lambda r: r[1] - r[0])
        if y1 - y0 < 50:
            continue
        cols = np.where(nw[y0:y1].mean(axis=0) > 0.6)[0]
        if len(cols) < 30:
            continue
        end = cols[0]
        for c in cols[1:]:
            if c - end > 4:
                break
            end = c
        ys0.append(y0 + 540); ys1.append(y1 + 540); xs0.append(cols[0] + 30); xs1.append(end + 30)
    if not ys0:
        return {"X0": X0, "Y0": Y0, "Y1": Y1, "CW": CW, "CH": CH, "XMAX": XMAX}
    y0, y1, x0 = int(np.median(ys0)), int(np.median(ys1)), int(np.median(xs0))
    ch = y1 - y0
    cw = int(round(ch * 66 / 92))
    # larghezza massima della zona mano: nel layout di riferimento 347 px per carte alte 92
    return {"X0": x0, "Y0": y0, "Y1": y1, "CW": cw, "CH": ch, "XMAX": x0 + int(round(347 * ch / 92))}

def right_edge(strip):
    bg = wood_mask(strip).mean(axis=0)
    cols = np.where(bg < 0.5)[0]
    return int(cols.max()) + 1 if len(cols) else 0

def slice_score(sl, ref, w):
    r = ref[:, :w]
    res = cv2.matchTemplate(sl, r[4:-4, 2:max(w - 2, 3)], cv2.TM_CCOEFF_NORMED)
    return float(res.max())

def recognize(frame, refs, g=None):
    g = g or {"X0": X0, "Y0": Y0, "Y1": Y1, "CW": CW, "CH": CH, "XMAX": XMAX}
    x0, y0, y1, cw, xmax = g["X0"], g["Y0"], g["Y1"], g["CW"], g["XMAX"]
    pitch = cw * 69 / 66
    strip = frame[y0 - 4:y1 + 4, max(0, x0 - 2):xmax + 4]
    total = right_edge(frame[y0:y1, x0:xmax + 4])
    if total < 30:
        return 0, [], []
    best = None
    # senza sovrapposizione le carte sono a passo fisso: n e' determinato dal bordo destro
    if total < xmax - x0 - 20:
        ns = [max(1, round((total + 3) / pitch))]
    else:
        ns = range(5, 12)
    for n in ns:
        s = cw if n == 1 else (total - cw) / (n - 1)
        if s < 12 or s > cw + 8:
            continue
        cards, scores = [], []
        for i in range(n):
            x = int(round(i * s))
            w = int(min(cw, s if i < n - 1 else cw))
            w = max(w, 14)
            sl = strip[:, x:x + w + 4]
            if sl.shape[1] < w or sl.shape[0] < g["CH"] - 8:
                continue
            sc = {cid: slice_score(sl, r, w) for cid, r in refs.items()}
            cid = max(sc, key=sc.get)
            cards.append(cid); scores.append(round(sc[cid], 3))
        if not scores:
            continue
        m = float(np.mean(scores))
        if best is None or m > best[0]:
            best = (m, len(cards), cards, scores)
    if best is None:
        return 0, [], []
    return best[1], best[2], best[3]

CARDS_JSON = "C:/Users/Admin/Documents/GitHub/Sailing-Network-bot/public/data/cards.json"

def pool_for_colors(colors):
    c = json.load(open(CARDS_JSON, encoding="utf-8"))
    return [x["id"] for x in c if x["category"] != "Leader" and set(x["colors"]) & set(colors)]

def snapshots(video, game_json, out_json):
    """mano di madoka all'inizio (dopo il +2 DON!!) e alla fine di ogni suo turno"""
    import tempfile
    g = json.load(open(game_json, encoding="utf-8"))
    cards = {x["id"]: x for x in json.load(open(CARDS_JSON, encoding="utf-8"))}
    lid = g["leaders"]["You"]["id"]
    shots = []
    for t in g["turns"]:
        if t["player"] != "You" or not t["events"]:
            continue
        ts = [e["t"] for e in t["events"] if e["type"] in ("draw", "don")] or [t["events"][0]["t"]]
        shots.append((t["turn"], "inizio", ts[0] + 0.6))
        shots.append((t["turn"], "fine", t["events"][-1]["t"] - 0.5))
    tmp = tempfile.mkdtemp()
    gframes = []
    for k, (_, _, sec) in enumerate(shots[::max(1, len(shots) // 8)]):
        f = os.path.join(tmp, f"geom{k}.png")
        subprocess.run(["ffmpeg", "-loglevel", "error", "-ss", str(max(0, sec)), "-i", video, "-frames:v", "1",
                        "-vf", "scale=1280:720", f, "-y"], check=True)
        gframes.append(cv2.imread(f))
    geom = detect_geom(gframes)
    print("geometria mano:", geom, file=sys.stderr)
    refs = load_refs(pool_for_colors(cards[lid]["colors"]), geom["CW"], geom["CH"])
    cache_p = os.path.join(os.path.dirname(os.path.abspath(game_json)), "hand_cache.json")
    cache = json.load(open(cache_p)) if os.path.exists(cache_p) else {}
    if cache.get("_geom") != geom:
        cache = {"_geom": geom}
    res = []
    for turn, when, sec in shots:
        f = os.path.join(tmp, f"{turn}_{when}.png")
        key = f"{sec:.1f}"
        if key in cache:
            n, ids, sc = cache[key]
        else:
            subprocess.run(["ffmpeg", "-loglevel", "error", "-ss", str(max(0, sec)), "-i", video, "-frames:v", "1",
                            "-vf", "scale=1280:720", f, "-y"], check=True)
            n, ids, sc = recognize(cv2.imread(f), refs, geom)
            cache[key] = [n, ids, sc]
            json.dump(cache, open(cache_p, "w"))
        res.append({"turn": turn, "when": when, "t": round(sec, 1), "n": n,
                    "cards": [f"{i} {cards[i]['name'].replace('&amp;', '&')}" + ("" if s >= 0.6 else " (?)") for i, s in zip(ids, sc)],
                    "scores": sc, "frame": f})
    for t in g["turns"]:
        t["hand_you"] = [{k: v for k, v in r.items() if k != "frame"} for r in res if r["turn"] == t["turn"]]
    json.dump(g, open(out_json, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    return res

if __name__ == "__main__" and len(sys.argv) > 1 and sys.argv[1] == "snap":
    # uso: python -P hand_rec.py snap VIDEO.mp4 game.json game_out.json
    for r in snapshots(sys.argv[2], sys.argv[3], sys.argv[4]):
        print(r["turn"], r["when"], r["t"], r["n"], [c.split(" ", 1)[1] for c in r["cards"]], r["scores"], r["frame"])
    raise SystemExit

if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("video"); ap.add_argument("out")
    ap.add_argument("--pool", required=True)
    ap.add_argument("--fps", type=float, default=1)
    ap.add_argument("--frames", help="cartella di fotogrammi interi gia' estratti (1280x720)")
    a = ap.parse_args()
    refs = load_refs(a.pool.split(","))
    fdir = a.frames
    if not fdir:
        fdir = os.path.join(a.out, "full1fps")
        os.makedirs(fdir, exist_ok=True)
        if not glob.glob(os.path.join(fdir, "*.png")):
            subprocess.run(["ffmpeg", "-loglevel", "error", "-i", a.video, "-vf",
                            f"fps={a.fps},scale=1280:720", os.path.join(fdir, "%05d.png")], check=True)
    out = []
    for i, f in enumerate(sorted(glob.glob(os.path.join(fdir, "*.png")))):
        n, cards, scores = recognize(cv2.imread(f), refs)
        out.append({"t": round(i / a.fps, 1), "n": n, "cards": cards, "scores": scores})
    json.dump(out, open(os.path.join(a.out, "hand.json"), "w"), indent=0)
    print("frames:", len(out))
