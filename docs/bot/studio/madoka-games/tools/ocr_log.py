"""Step 1: OCR del pannello "combat log" di OPTCGSim in un video di madoka_hk.

Uso:
  python -P ocr_log.py VIDEO.mp4 OUT_DIR [--crop x,y,w,h] [--fps 4] [--workers 6]

- estrae con ffmpeg solo il ritaglio del log (default 132,172,270,273 su video
  riscalato a 1280x720: e' il pannello a sinistra nel layout di madoka)
- scarta i fotogrammi in cui il log non cambia
- fa OCR (RapidOCR, CPU, in parallelo) e salva OUT_DIR/ocr_frames.json:
  [{t, lines:[{y,x,text,score}]}]   (y in pixel del ritaglio x2)
"""
import argparse, json, os, subprocess, sys, glob
import cv2, numpy as np
from rapidocr_onnxruntime import RapidOCR

_ocr = None

def ocr_one(item):
    global _ocr
    if _ocr is None:
        _ocr = RapidOCR(use_cls=False, det_limit_side_len=400, intra_op_num_threads=2)
    t, f = item
    im = cv2.imread(f)
    big = cv2.resize(im, None, fx=1.5, fy=1.5, interpolation=cv2.INTER_CUBIC)
    r, _ = _ocr(big)
    lines = [{"y": int(b[0][1] / 1.5 * 2), "x": int(b[0][0]), "text": tx, "score": round(float(sc), 3)}
             for b, tx, sc in (r or [])]
    lines.sort(key=lambda l: l["y"])
    return {"t": t, "lines": lines}

def detect_crop(video):
    """trova il riquadro chiaro della chat/log a sinistra (Report Player .. Mute Chat)
    su alcuni fotogrammi e ne ricava l'area del testo"""
    import tempfile
    tmp = tempfile.mkdtemp()
    subprocess.run(["ffmpeg", "-loglevel", "error", "-i", video, "-vf", "fps=1/30,scale=1280:720",
                    os.path.join(tmp, "%03d.png")], check=True)
    boxes = []
    for f in sorted(glob.glob(os.path.join(tmp, "*.png")))[1:]:
        im = cv2.imread(f)
        hsv = cv2.cvtColor(im, cv2.COLOR_BGR2HSV)
        m = ((hsv[:, :, 1] < 140) & (hsv[:, :, 2] > 140)).astype(np.uint8)
        m[:, 460:] = 0; m[:120, :] = 0; m[560:, :] = 0
        m = cv2.morphologyEx(m, cv2.MORPH_CLOSE, np.ones((9, 9), np.uint8))
        n, lab, st, _ = cv2.connectedComponentsWithStats(m)
        if n < 2:
            continue
        i = 1 + int(np.argmax(st[1:, 4]))
        if st[i, 4] > 50000:
            boxes.append(st[i, :4])
    bx, by, bw, bh = np.median(np.array(boxes), axis=0).astype(int)
    return f"{bx + 66},{by + 22},{bw - 76},{bh - 63}"

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("video"); ap.add_argument("out")
    ap.add_argument("--crop", default="auto", help="x,y,w,h oppure auto")
    ap.add_argument("--fps", type=float, default=4)
    ap.add_argument("--workers", type=int, default=6)
    ap.add_argument("--diff", type=float, default=2.0, help="soglia differenza media per ri-OCR")
    a = ap.parse_args()

    if a.crop == "auto":
        a.crop = detect_crop(a.video)
        print("crop rilevato:", a.crop, file=sys.stderr)
    x, y, w, h = map(int, a.crop.split(","))
    fdir = os.path.join(a.out, "logcrop")
    os.makedirs(fdir, exist_ok=True)
    if not glob.glob(os.path.join(fdir, "*.png")):
        subprocess.run(["ffmpeg", "-loglevel", "error", "-i", a.video, "-vf",
                        f"fps={a.fps},scale=1280:720,crop={w}:{h}:{x}:{y}",
                        os.path.join(fdir, "%06d.png")], check=True)
    files = sorted(glob.glob(os.path.join(fdir, "*.png")))
    todo, prev = [], None
    for i, f in enumerate(files):
        im = cv2.imread(f, cv2.IMREAD_GRAYSCALE).astype(np.int16)
        if prev is not None and np.abs(im - prev).mean() < a.diff:
            continue
        prev = im
        todo.append((round(i / a.fps, 2), f))
    print("frames da OCR:", len(todo), "di", len(files), file=sys.stderr)
    from multiprocessing import Pool
    with Pool(a.workers) as pool:
        out = pool.map(ocr_one, todo, chunksize=4)
    json.dump(out, open(os.path.join(a.out, "ocr_frames.json"), "w", encoding="utf-8"),
              ensure_ascii=False, indent=0)
    print("frames OCR:", len(out), "di", len(files))

if __name__ == "__main__":
    main()
