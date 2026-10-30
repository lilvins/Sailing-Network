/* The backdrop of the whole Home: one calm night-blue colour with a pixel
   wave pattern drifting diagonally, a few twinkling stars, a little boat
   crossing and two gulls. Art: scripts/build-home-pattern.mjs (tile, boat),
   the stars and gulls already used on the night sea. All CSS (home.css),
   still under prefers-reduced-motion. */
import type { CSSProperties } from "react";

// [left %, top %, star kind, twinkle delay s]
const STARS: [number, number, "a" | "b", number][] = [
  [8, 12, "a", 0], [23, 38, "b", 1.2], [41, 9, "b", 2.1], [57, 27, "a", 0.6],
  [72, 14, "b", 1.7], [88, 33, "a", 2.6], [14, 64, "b", 0.9], [35, 81, "a", 2.3],
  [63, 58, "b", 1.4], [81, 76, "a", 0.3], [94, 52, "b", 2.0],
];

export function PixelBackdrop() {
  return (
    <div className="hbg" aria-hidden="true">
      {STARS.map(([l, t, k, d], i) => (
        <img
          key={i}
          className={`hbg-star ${k}`}
          src={`/assets/bg/star-${k}.png`}
          alt=""
          style={{ left: `${l}%`, top: `${t}%`, animationDelay: `${d}s` } as CSSProperties}
        />
      ))}
      <img className="hbg-boat" src="/assets/bg/home-pattern/boat.png" alt="" />
      <i className="hbg-gull g1" />
      <i className="hbg-gull g2" />
    </div>
  );
}
