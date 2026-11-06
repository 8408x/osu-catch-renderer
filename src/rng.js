// Ports of the two random number generators osu!lazer uses for catch.
//
//  - LegacyRandom: osu!stable's xorshift. One shared instance (seed 1337) walks the whole beatmap to
//    place bananas, jitter tiny droplets and (with Hard Rock) offset fruit.
//  - StatelessRNG: a 64-bit hash of (seed, series). Used for banana colour, scale and rotation, where
//    seed = (int) start time. Needs BigInt because the multiplications are 64-bit.

const INT_MASK = 0x7fffffff;
const INT_TO_REAL = 1 / 2147483648; // 1.0 / (int.MaxValue + 1.0)

export class LegacyRandom {
  constructor(seed) {
    this.x = seed >>> 0;
    this.y = 842502087;
    this.z = 3579807591;
    this.w = 273326509;
    this.bitBuffer = 0;
    this.bitIndex = 32;
  }

  nextUInt() {
    const t = (this.x ^ (this.x << 11)) >>> 0;
    this.x = this.y;
    this.y = this.z;
    this.z = this.w;
    this.w = (this.w ^ (this.w >>> 19) ^ t ^ (t >>> 8)) >>> 0;
    return this.w;
  }

  /** Non-negative 31 bit integer. */
  next() { return (this.nextUInt() & INT_MASK) >>> 0; }

  nextDouble() { return INT_TO_REAL * this.next(); }

  /** Integer in [lower, upper), truncated toward zero like C#'s (int) cast. */
  nextRange(lower, upper) { return Math.trunc(lower + this.nextDouble() * (upper - lower)) + 0; } // + 0 turns -0 into 0

  nextBool() {
    if (this.bitIndex === 32) {
      this.bitBuffer = this.nextUInt();
      this.bitIndex = 1;
      return (this.bitBuffer & 1) === 1;
    }
    this.bitIndex++;
    this.bitBuffer >>>= 1;
    return (this.bitBuffer & 1) === 1;
  }
}

const M64 = (1n << 64n) - 1n;
function mix(x) {
  x ^= x >> 33n;
  x = (x * 0xff51afd7ed558ccdn) & M64;
  x ^= x >> 33n;
  x = (x * 0xc4ceb9fe1a85ec53n) & M64;
  x ^= x >> 33n;
  return x;
}

export function statelessULong(seed, series = 0) {
  const combined = (BigInt(series >>> 0) << 32n) | BigInt(seed >>> 0);
  return mix(combined ^ 0x12345678n);
}

export function statelessInt(maxValue, seed, series = 0) {
  return Number(statelessULong(seed, series) % BigInt(maxValue));
}

/** Float in [0, 1) with 24 bits of precision (what a C# float can hold). */
export function statelessSingle(seed, series = 0) {
  return Number(statelessULong(seed, series) & 0xffffffn) / 16777216;
}
