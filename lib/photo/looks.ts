/**
 * Sunset looks for photos (SPEC.md §4, Photo). Pure pixel math on RGBA bytes: no canvas, no DOM,
 * so the web app and a later Android app share it. Each look is a short recipe, and the photo is
 * processed at whatever size it is given: the screen gets a small preview, the save gets every pixel.
 */

export type LookId = "original" | "natural" | "golden" | "ember" | "dusk";

export interface LookRecipe {
  /** Exposure in stops, in linear light. A little under deepens the sky's color. */
  exposure: number;
  /** White balance: positive warms (more red, less blue), negative cools. */
  warmth: number;
  /** Positive leans magenta, negative green. */
  tint: number;
  /** S-curve strength, 0 for none. */
  contrast: number;
  /** Lifts (positive) or deepens (negative) the darkest tones. */
  blacks: number;
  /** Extra color for the muted parts, leaving what is already vivid alone. */
  vibrance: number;
  /** Extra color everywhere. */
  saturation: number;
  /** Turns the warm colors toward red: yellow to orange, orange to red. Blues and greens are left alone. */
  redShift: number;
  /** Color nudged into the shadows and into the highlights, as red, green, blue offsets. */
  shadows: readonly [number, number, number];
  highlights: readonly [number, number, number];
}

export interface PhotoLook {
  id: LookId;
  name: string;
  /** One line under the name. */
  hint: string;
  /** Null leaves the photo exactly as the camera made it. */
  recipe: LookRecipe | null;
}

/** Few on purpose: the untouched photo, one gentle correction and three moods. */
export const LOOKS: readonly PhotoLook[] = [
  { id: "original", name: "Original", hint: "As the camera took it", recipe: null },
  {
    id: "natural",
    name: "True",
    hint: "Closer to what you saw",
    recipe: {
      exposure: -0.12,
      warmth: 0.1,
      tint: 0.02,
      contrast: 0.2,
      blacks: -0.01,
      vibrance: 0.28,
      saturation: 0.04,
      redShift: 0,
      shadows: [0, 0, 0],
      highlights: [0, 0, 0],
    },
  },
  {
    id: "golden",
    name: "Golden",
    hint: "Warm, deep and glowing",
    recipe: {
      exposure: -0.32,
      warmth: 0.2,
      tint: 0.05,
      contrast: 0.32,
      blacks: -0.015,
      vibrance: 0.55,
      saturation: 0.1,
      redShift: 0,
      shadows: [-0.015, 0, 0.03],
      highlights: [0.045, 0.01, -0.045],
    },
  },
  {
    id: "ember",
    name: "Ember",
    hint: "Deeper orange and red",
    recipe: {
      exposure: -0.36,
      warmth: 0.16,
      tint: 0.05,
      contrast: 0.32,
      blacks: -0.015,
      vibrance: 0.5,
      saturation: 0.12,
      redShift: 0.22,
      shadows: [-0.012, 0, 0.025],
      highlights: [0.045, -0.005, -0.04],
    },
  },
  {
    id: "dusk",
    name: "Dusk",
    hint: "Cool blues, pink and violet",
    recipe: {
      exposure: -0.18,
      warmth: -0.1,
      tint: 0.16,
      contrast: 0.16,
      blacks: 0.02,
      vibrance: 0.42,
      saturation: 0.05,
      redShift: 0,
      shadows: [0, -0.01, 0.04],
      highlights: [0.03, -0.012, 0.02],
    },
  },
];

export const lookById = (id: LookId): PhotoLook => LOOKS.find((look) => look.id === id) ?? LOOKS[0];

const toLinear = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const toGamma = (v: number) => (v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055);

/** A recipe turned into lookup tables, built once per look and reused for every strip of the photo. */
export interface PreparedLook {
  recipe: LookRecipe;
  /** Tone curves for red, green and blue: byte in, 0–1 out. */
  curves: [Float32Array, Float32Array, Float32Array];
}

export function prepareLook(recipe: LookRecipe): PreparedLook {
  // White balance as channel gains, scaled to keep overall brightness.
  const raw = [2 ** (recipe.warmth * 0.35), 2 ** (-recipe.tint * 0.2), 2 ** (-recipe.warmth * 0.45)];
  const luma = 0.2126 * raw[0] + 0.7152 * raw[1] + 0.0722 * raw[2];
  const exposure = 2 ** recipe.exposure;
  const gains = raw.map((g) => (g / luma) * exposure);

  const curves = gains.map((gain) => {
    // A gain above 1 would clip the brightest tones (the sun, its halo). Roll them off instead:
    // unchanged up to the knee, then eased so the brightest input lands exactly on white.
    const max = Math.max(1, gain);
    const knee = Math.max(0, 2 - max);
    const curve = new Float32Array(256);
    for (let i = 0; i < 256; i++) {
      let v = toLinear(i / 255) * gain;
      if (max > 1 && v > knee) {
        const t = (v - knee) / (max - knee);
        v = knee + (1 - knee) * (1 - (1 - t) * (1 - t));
      }
      v = toGamma(v);
      v += recipe.contrast * (v * v * (3 - 2 * v) - v);
      v += recipe.blacks * (1 - v) * (1 - v);
      curve[i] = Math.min(1, Math.max(0, v));
    }
    return curve;
  }) as PreparedLook["curves"];
  return { recipe, curves };
}

/**
 * Applies a look to RGBA bytes in place. `offset` is the index of the first pixel within the whole
 * photo, so strips processed one after another get the same grain as one pass over everything.
 *
 * The result is dithered by under one level before rounding: a sunset sky is one long smooth
 * gradient, and curves applied to 8-bit color would otherwise leave visible bands in it.
 */
export function applyLook(pixels: Uint8ClampedArray, look: PreparedLook, offset = 0): void {
  const [red, green, blue] = look.curves;
  const { vibrance, saturation, redShift, shadows, highlights } = look.recipe;
  const toned = shadows.some((v) => v !== 0) || highlights.some((v) => v !== 0);

  for (let i = 0, n = offset; i < pixels.length; i += 4, n++) {
    let r = red[pixels[i]];
    let g = green[pixels[i + 1]];
    let b = blue[pixels[i + 2]];

    let y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    if (toned) {
      const dark = (1 - y) * (1 - y);
      const bright = y * y;
      r += dark * shadows[0] + bright * highlights[0];
      g += dark * shadows[1] + bright * highlights[1];
      b += dark * shadows[2] + bright * highlights[2];
      y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    }

    // Warm colors (red above green above blue) lose some green, which turns them toward red. The
    // pull fades to nothing at neutral and at pure yellow, so there is no edge where it starts.
    if (redShift > 0 && r > g && g > b) {
      const pull = redShift * (g - b) * Math.min(1, (r - g) / 0.08);
      g -= pull;
      // Half the brightness the green carried goes back to all three, so the sky doesn't dull.
      const back = pull * 0.7152 * 0.5;
      r += back;
      g += back;
      b += back;
      y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    }

    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const vivid = max > 0 ? (max - min) / max : 0;
    let boost = 1 + saturation + vibrance * (1 - vivid);
    // Keep the hue where a channel would overflow: pull the boost back just enough to fit.
    if (boost > 1) {
      if (max > y) boost = Math.min(boost, (1 - y) / (max - y));
      if (min < y) boost = Math.min(boost, y / (y - min));
      if (boost < 1) boost = 1;
    }
    r = y + (r - y) * boost;
    g = y + (g - y) * boost;
    b = y + (b - y) * boost;

    // Cheap repeatable noise in (-0.5, 0.5) levels, different per pixel and per channel.
    let h = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b);
    h ^= h >>> 15;
    h = Math.imul(h, 0xc2b2ae35);
    h ^= h >>> 13;
    pixels[i] = r * 255 + ((h & 0xff) / 255 - 0.5);
    pixels[i + 1] = g * 255 + (((h >>> 8) & 0xff) / 255 - 0.5);
    pixels[i + 2] = b * 255 + (((h >>> 16) & 0xff) / 255 - 0.5);
  }
}
