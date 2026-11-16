/**
 * Every tunable number of the v1 sunset score (SPEC.md §5.4–5.6).
 * These are educated first guesses, to be tuned against logged sunsets.
 */

/** Distances (km) along the sunset bearing where weather is sampled. Negative = behind you (east). */
export const SAMPLE_KM = [-25, 0, 25, 50, 100, 150, 200, 300] as const;

export const config = {
  /**
   * Bump when the formula's shape changes, so logged scores can be told apart.
   * 1: one product of factors. 2: the clear-sky glow is scored apart from lit cloud (16 Nov 2026).
   */
  formula: 2,

  /** Weather is read this many minutes after sunset, around typical peak color. */
  evalOffsetMin: 10,

  /** Canvas: high + mid cloud that gets lit, weighted by distance. */
  canvasWeights: [[-25, 0.1], [0, 0.35], [25, 0.25], [50, 0.2], [100, 0.1]],
  /** Light path: low + mid cloud far toward the sun that blocks the light. */
  gapWeights: [[100, 0.15], [150, 0.25], [200, 0.3], [300, 0.3]],
  /** Low cloud overhead is averaged over these points. */
  lowOverKm: [0, 25],
  /** Open sky: how free of high and mid cloud it is above and around you. */
  openSkyWeights: [[-25, 0.15], [0, 0.5], [25, 0.35]],

  potential: [[0, 0.4], [0.1, 0.5], [0.3, 0.85], [0.4, 1], [0.7, 1], [0.9, 0.85], [1, 0.7]],
  /**
   * The clear-sky glow: the horizon gradient an open sky gives without any cloud to light.
   * `base` is its worth under a fully open sky (keep it equal to the first `potential` value);
   * a cloud bank far toward the sun takes at most `gapMax` of it, where lit cloud loses `gap.max`.
   */
  glow: { base: 0.4, gapMax: 0.25 },
  gap: { max: 0.85, from: 0.2, to: 0.8 },
  lowCloud: { max: 0.8, from: 0.4, to: 0.9 },

  /** Air clarity: the lowest of these three curves wins. */
  aod: [[0.2, 1], [0.35, 0.85], [0.5, 0.65], [0.8, 0.4]],
  visibilityKm: [[1, 0.3], [5, 0.6], [10, 0.85], [20, 1]],
  humidity: [[80, 1], [90, 0.85], [97, 0.7]],

  rain: { heavyMmH: 0.5, heavyFactor: 0.4, lightMmH: 0.1, lightFactor: 0.75 },
  clearing: { minPrev6hMm: 1, maxNowMmH: 0.1, maxGapBlock: 0.4, bonus: 8 },

  labels: [[85, "Epic"], [65, "Great"], [45, "Good"], [25, "Fair"], [0, "Poor"]],

  look: {
    greyLowOver: 0.85,
    blockedGap: 0.75,
    /** With at least this much open sky, a far cloud bank dims the glow rather than blocking the show. */
    openSky: 0.7,
    hazyAir: 0.6,
    cleanCanvas: 0.1,
    wholeSkyCanvas: 0.75,
    wholeSkyGap: 0.3,
    dominantShare: 0.6,
    pastelMaxAod: 0.2,
  },

  /**
   * Model spread bands for high and medium confidence. Confidence drops a level when sunset is more
   * than `longLeadHours` away, and another beyond `veryLongLeadHours` (only the outlook looks that far):
   * days ahead, the models agree more than their forecasts deserve.
   */
  confidence: { highSpread: 15, mediumSpread: 30, longLeadHours: 12, veryLongLeadHours: 72 },
} as const;

export type Config = typeof config;
