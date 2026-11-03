import type { SamplePoint } from "@/lib/forecast/score";

const ROWS = [
  { key: "high", label: "High", color: "#f3a6c8" },
  { key: "mid", label: "Mid", color: "#f6a15b" },
  { key: "low", label: "Low", color: "#9aa7bd" },
] as const;

const WIDTH = 340;
const LABEL_W = 30;
const TOP = 16;
const ROW_H = 28;

/** Cloud cover at each sample point along the sunset line, as a 3-row heat strip. */
export function SkyStrip({ path }: { path: SamplePoint[] }) {
  const cell = (WIDTH - LABEL_W) / path.length;
  const gridBottom = TOP + ROW_H * ROWS.length;
  const centerOf = (i: number) => LABEL_W + cell * i + cell / 2;
  const indexOfKm = (km: number) => path.findIndex((p) => p.km === km);

  const bracket = (fromKm: number, toKm: number, text: string, inset: [number, number]) => {
    const x0 = centerOf(indexOfKm(fromKm)) + inset[0];
    const x1 = centerOf(indexOfKm(toKm)) + inset[1];
    const y = gridBottom + 8;
    return (
      <g>
        <path d={`M${x0} ${y - 4}V${y}H${x1}V${y - 4}`} fill="none" stroke="#8a8194" strokeWidth="1" />
        <text x={(x0 + x1) / 2} y={y + 12} textAnchor="middle" fontSize="9" fill="#b8aebf">
          {text}
        </text>
      </g>
    );
  };

  return (
    <svg
      viewBox={`0 0 ${WIDTH} ${gridBottom + 26}`}
      className="w-full"
      role="img"
      aria-label="Cloud cover at high, mid and low levels along the line toward the sunset"
    >
      {path.map((p, i) => (
        <text
          key={p.km}
          x={centerOf(i)}
          y={10}
          textAnchor="middle"
          fontSize="9"
          fill={p.km === 0 ? "#f6efe7" : "#8a8194"}
          fontWeight={p.km === 0 ? 600 : 400}
        >
          {p.km === 0 ? "you" : p.km < 0 ? `−${-p.km}` : p.km}
        </text>
      ))}

      {ROWS.map((row, r) => (
        <g key={row.key}>
          <text x={0} y={TOP + r * ROW_H + ROW_H / 2 + 3} fontSize="9" fill="#b8aebf">
            {row.label}
          </text>
          {path.map((p, i) => {
            const value = p[row.key];
            const x = LABEL_W + cell * i;
            const y = TOP + r * ROW_H;
            return (
              <g key={p.km}>
                <rect
                  x={x + 1.5}
                  y={y + 1.5}
                  width={cell - 3}
                  height={ROW_H - 3}
                  rx={5}
                  fill={row.color}
                  fillOpacity={0.07 + 0.88 * value}
                />
                {value >= 0.05 && (
                  <text
                    x={x + cell / 2}
                    y={y + ROW_H / 2 + 3}
                    textAnchor="middle"
                    fontSize="9"
                    fill={value > 0.55 ? "#1a1320" : "#f6efe7"}
                  >
                    {Math.round(value * 100)}
                  </text>
                )}
              </g>
            );
          })}
        </g>
      ))}

      {bracket(-25, 100, "canvas: lights up", [-cell / 2 + 2, -2])}
      {bracket(100, 300, "light path: can block it", [2, cell / 2 - 2])}
    </svg>
  );
}
