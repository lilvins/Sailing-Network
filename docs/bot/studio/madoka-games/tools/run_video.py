"""Pipeline completa per UN video gia' scaricato.

Uso (da una cartella di lavoro FUORI dal repo, es. %TEMP%\\madoka-vision):
  python -P run_video.py VIDEO_ID "Titolo del video" [--skip-hand]

Si aspetta VIDEO_ID.mp4 nella cartella corrente. Produce g_VIDEO_ID/ (lavoro) e copia
  docs/bot/studio/madoka-games/VIDEO_ID.json   (game record)
  docs/bot/studio/madoka-games/VIDEO_ID.md     (riassunto turno per turno)

Download (lento, uno alla volta, >=60 s fra un video e l'altro):
  python -m yt_dlp -f "bv*[height<=720][ext=mp4]/bv*[height<=720]" --sleep-requests 5 \\
      -o "%(id)s.%(ext)s" https://www.youtube.com/watch?v=VIDEO_ID
"""
import os, subprocess, sys, shutil, json

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.dirname(HERE)

def run(*args):
    print(">", " ".join(args), flush=True)
    subprocess.run([sys.executable, "-P", *args], check=True)

vid, title = sys.argv[1], sys.argv[2]
skip_hand = "--skip-hand" in sys.argv
d = f"g_{vid}"
if not os.path.exists(os.path.join(d, "ocr_frames.json")):
    run(os.path.join(HERE, "ocr_log.py"), f"{vid}.mp4", d)
run(os.path.join(HERE, "merge_log.py"), d)
run(os.path.join(HERE, "parse_log.py"), d, "--video-id", vid, "--title", title)
gj = os.path.join(d, "game.json")
if not skip_hand:
    run(os.path.join(HERE, "hand_rec.py"), "snap", f"{vid}.mp4", gj, os.path.join(d, "game_hand.json"))
    gj = os.path.join(d, "game_hand.json")
    run(os.path.join(HERE, "parse_log.py"), "md", gj, os.path.join(d, "game.md"))
shutil.copy(gj, os.path.join(OUT, f"{vid}.json"))
shutil.copy(os.path.join(d, "game.md"), os.path.join(OUT, f"{vid}.md"))
shutil.copy(os.path.join(d, "log_lines.txt"), os.path.join(OUT, f"{vid}.log.txt"))
print("ok:", vid)
