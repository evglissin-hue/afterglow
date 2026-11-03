import { destination, roundTo, type LatLon } from "@/lib/geo";
import {
  MODELS,
  hourContaining,
  sumBefore,
  valueAt,
  type AirSeries,
  type ModelId,
  type PointSeries,
  type Weather,
} from "@/lib/weather/openmeteo";
import { SAMPLE_KM, config } from "./config";
import {
  combineModels,
  scoreSunset,
  type Combined,
  type ModelResult,
  type SamplePoint,
  type ScoreInput,
} from "./score";

/** Where weather is sampled: SAMPLE_KM along the sunset bearing (SPEC.md §5.3), to about 100 m. */
export function sampleLine(origin: LatLon, bearing: number): LatLon[] {
  return SAMPLE_KM.map((km) => {
    const p = destination(origin, bearing, km);
    return { lat: roundTo(p.lat, 0.001), lon: roundTo(p.lon, 0.001) };
  });
}

/** One model's score for one sunset, with the cloud and air it was scored from. */
export interface ModelScore extends ModelResult<ModelId> {
  input: ScoreInput;
}

export interface EveningScore {
  /** Every model that covers this sunset, in MODELS order. */
  results: ModelScore[];
  /** The median score, and how well the models agree (SPEC.md §5.6). */
  combined: Combined<ModelId>;
  /** The model closest to the median: its look, reasons and cloud are the ones shown. */
  shown: ModelScore;
  /** Hours from now until sunset. */
  leadHours: number;
}

/**
 * Scores one sunset with each model that has cloud data for it, and combines them.
 * Weather is read `config.evalOffsetMin` after sunset. Null when no model covers that time.
 */
export function scoreEvening(weather: Weather, coords: LatLon[], sunset: Date, now: Date): EveningScore | null {
  const t = sunset.getTime() / 1000 + config.evalOffsetMin * 60;
  const results = MODELS.flatMap((model) => {
    const series = weather.forecast.models[model];
    const input = series ? scoreInputFor(series, coords, weather.air, t) : null;
    return input ? [{ model, result: scoreSunset(input), input }] : [];
  });
  if (results.length === 0) return null;

  const leadHours = (sunset.getTime() - now.getTime()) / 3_600_000;
  const combined = combineModels(results, leadHours);
  const shown = results.find((r) => r.model === combined.primary.model)!;
  return { results, combined, shown, leadHours };
}

function scoreInputFor(
  series: PointSeries[],
  coords: LatLon[],
  air: AirSeries | null,
  t: number,
): ScoreInput | null {
  const points: SamplePoint[] = [];
  for (let i = 0; i < series.length; i++) {
    const s = series[i];
    const low = valueAt(s.time, s.low, t);
    const mid = valueAt(s.time, s.mid, t);
    const high = valueAt(s.time, s.high, t);
    if (low == null || mid == null || high == null) return null;
    points.push({ km: SAMPLE_KM[i], ...coords[i], low: low / 100, mid: mid / 100, high: high / 100 });
  }

  const here = series[SAMPLE_KM.indexOf(0)];
  const visibility = valueAt(here.time, here.visibility, t);
  return {
    points,
    observer: {
      visibilityKm: visibility == null ? null : visibility / 1000,
      humidity: valueAt(here.time, here.humidity, t),
      rainNow: hourContaining(here.time, here.precipitation, t) ?? 0,
      rainPrev6h: sumBefore(here.time, here.precipitation, t, 6),
      aod: air ? valueAt(air.time, air.aod, t) : null,
    },
  };
}
