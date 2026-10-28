/* The living night-sea pixel scene, shared by the Home hero and the Login
   pane. Real PNG layers + tiny pixel sprites (scripts/build-mode-cards.mjs):
   twinkling stars, two cloud layers in parallax, double water shimmer,
   the occasional shooting star, slow sea sparks; plus the CC0 animated water
   texture on the sea, gulls and a far-off brig (scripts/build-pixel-fx.mjs).
   All CSS, no canvas, everything off under prefers-reduced-motion (home.css). */
import type { CSSProperties } from "react";

type Star =[left: number, top: number, kind: "a" | "b", dur: number, delay: number];

const STARS: Star[] = [
  [5, 9, "a", 2.6, 0],
  [11, 24, "b", 3.4, 1.1],
  [18, 5, "b", 2.2, 0.4],
  [25, 16, "a", 3.8, 2.2],
  [32, 8, "b", 2.9, 1.6],
  [40, 20, "b", 3.1, 0.2],
  [47, 4, "a", 2.4, 1.9],
  [56, 14, "b", 3.6, 0.8],
  [63, 26, "a", 2.8, 2.6],
  [71, 7, "b", 3.3, 1.3],
  [79, 18, "a", 2.5, 0.6],
  [87, 10, "b", 3.7, 2.0],
  [93, 22, "a", 3.0, 1.0],
  [52, 30, "b", 4.0, 2.9],
];

/* water rows from the horizon down: [tile height, tile width, drift] in
   cqw of the painting. Smaller + flatter tiles far away = cheap perspective;
   each row is ONE tile tall, so repeat-x shows a single frame of the sheet. */
const WATER: [number, number, "normal" | "reverse"][] = [
  [0.5, 1.4, "normal"],
  [0.9, 2.2, "reverse"],
  [1.4, 3.2, "normal"],
  [2.1, 4.4, "reverse"],
  [2.9, 5.6, "normal"],
  [3.4, 6.8, "reverse"],
  [4.15, 8.3, "normal"],
];

export function NightSea() {
  return (
    <div className="nsea" aria-hidden="true">
      <div className="nsea-layer nsea-base" />
      <div className="nsea-stars">
        {STARS.map(([l, t, k, dur, delay], i) => (
          <img
            key={i}
            className="nsea-star"
            src={`/assets/bg/star-${k}.png`}
            alt=""
            style={{
              left: `${l}%`,
              top: `${t}%`,
              width: k === "a" ? 10 : 6,
              animationDuration: `${dur}s`,
              animationDelay: `${delay}s`,
            }}
          />
        ))}
      </div>
      <div className="nsea-layer nsea-clouds nsea-clouds-far" />
      <div className="nsea-layer nsea-moon" />
      <div className="nsea-layer nsea-clouds" />
      <div className="nsea-layer nsea-refl" />
      <div className="nsea-layer nsea-refl nsea-refl2" />
      {/* sprites pinned to the painting itself (same box as background-size:
          cover), so the ship sits ON the horizon at every aspect ratio */}
      <div className="nsea-art">
        <div className="nsea-water">
          {WATER.map(([h, w, drift], i) => (
            <span
              key={i}
              style={{ "--h": `${h}cqw`, "--w": `${w}cqw`, animationDelay: `${-i * 0.37}s, 0s`, animationDirection: `normal, ${drift}` } as CSSProperties}
            />
          ))}
        </div>
        <div className="nsea-ship"><img src="/assets/bg/fx/ship.png" alt="" /></div>
        <div className="nsea-gull g1"><i /></div>
        <div className="nsea-gull g2"><i /></div>
      </div>
      <img className="nsea-shoot nsea-shoot1" src="/assets/bg/star-shoot.png" alt="" />
      <img className="nsea-shoot nsea-shoot2" src="/assets/bg/star-shoot.png" alt="" />
      <span className="nsea-spark s1" />
      <span className="nsea-spark s2" />
      <span className="nsea-spark s3" />
    </div>
  );
}
