/* The One Piece world as a pixel sea chart, fixed behind the whole Home:
   the Red Line, Reverse Mountain, the Grand Line between its Calm Belts, the
   four Blues. Drawn by scripts/build-world-map.mjs (project-original, a
   placeholder until the map is commissioned). The chart box is sized like
   background-size: cover, so the glints and the ship stay ON the painting
   at every aspect ratio. Animation is off under prefers-reduced-motion. */
export function WorldMap() {
  return (
    <div className="wmap" aria-hidden="true">
      <div className="wmap-art">
        <img className="wmap-layer" src="/assets/bg/world-map/map.png" alt="" />
        <img className="wmap-layer wmap-spark a" src="/assets/bg/world-map/sparkle-a.png" alt="" />
        <img className="wmap-layer wmap-spark b" src="/assets/bg/world-map/sparkle-b.png" alt="" />
        <img className="wmap-ship" src="/assets/bg/world-map/ship.png" alt="" />
      </div>
      <i className="wmap-shade" />
    </div>
  );
}
