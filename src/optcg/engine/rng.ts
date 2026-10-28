// Small seedable PRNG (mulberry32). The state is a single uint32 so it can live
// inside GameState and survive structuredClone.

export function nextRandom(state: number): [value: number, next: number] {
  const next = (state + 0x6d2b79f5) | 0;
  let r = Math.imul(next ^ (next >>> 15), 1 | next);
  r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
  return [((r ^ (r >>> 14)) >>> 0) / 4294967296, next];
}

export class Rng {
  constructor(private state: number) {}

  next(): number {
    const [v, s] = nextRandom(this.state);
    this.state = s;
    return v;
  }

  int(n: number): number {
    return Math.floor(this.next() * n);
  }

  shuffle<T>(arr: T[]): T[] {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = this.int(i + 1);
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }
}
