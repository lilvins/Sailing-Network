// glicko2.mjs — one Glicko-2 update for one player after one game.
//
// Every game is treated as its own rating period (the usual simplification for
// online ladders). Pure: numbers in, numbers out. Reference: Glickman,
// "Example of the Glicko-2 system" (glicko.net/glicko/glicko2.pdf), steps 1–8.

const SCALE = 173.7178;

const g = (phi) => 1 / Math.sqrt(1 + (3 * phi * phi) / (Math.PI * Math.PI));
const expected = (mu, muJ, phiJ) => 1 / (1 + Math.exp(-g(phiJ) * (mu - muJ)));

/**
 * @param {{rating:number, rd:number, vol:number}} me
 * @param {{rating:number, rd:number}} opp
 * @param {0|1} score 1 = I won
 * @param {{startRating:number, tau:number, minRd:number}} cfg
 * @returns {{rating:number, rd:number, vol:number}}
 */
export function glicko2Update(me, opp, score, cfg) {
  // step 2: to the Glicko-2 scale
  const mu = (me.rating - cfg.startRating) / SCALE;
  const phi = me.rd / SCALE;
  const muJ = (opp.rating - cfg.startRating) / SCALE;
  const phiJ = opp.rd / SCALE;

  // steps 3–4: estimated variance and improvement
  const gJ = g(phiJ);
  const E = expected(mu, muJ, phiJ);
  const v = 1 / (gJ * gJ * E * (1 - E));
  const delta = v * gJ * (score - E);

  // step 5: new volatility (Illinois algorithm)
  const a = Math.log(me.vol * me.vol);
  const tau = cfg.tau;
  const f = (x) => {
    const ex = Math.exp(x);
    const d = phi * phi + v + ex;
    return (ex * (delta * delta - d)) / (2 * d * d) - (x - a) / (tau * tau);
  };
  let A = a;
  let B;
  if (delta * delta > phi * phi + v) B = Math.log(delta * delta - phi * phi - v);
  else {
    let k = 1;
    while (f(a - k * tau) < 0) k++;
    B = a - k * tau;
  }
  let fA = f(A);
  let fB = f(B);
  for (let i = 0; i < 100 && Math.abs(B - A) > 1e-6; i++) {
    const C = A + ((A - B) * fA) / (fB - fA);
    const fC = f(C);
    if (fC * fB <= 0) { A = B; fA = fB; } else fA /= 2;
    B = C; fB = fC;
  }
  const vol = Math.exp(A / 2);

  // steps 6–7: new RD and rating
  const phiStar = Math.sqrt(phi * phi + vol * vol);
  const phiNew = 1 / Math.sqrt(1 / (phiStar * phiStar) + 1 / v);
  const muNew = mu + phiNew * phiNew * gJ * (score - E);

  // step 8: back to the Glicko scale
  return {
    rating: muNew * SCALE + cfg.startRating,
    rd: Math.max(cfg.minRd, phiNew * SCALE),
    vol,
  };
}
