const RADIUS = 44;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

export function ScoreDial({ score, label }: { score: number; label: string }) {
  return (
    <div
      className="relative size-28 shrink-0"
      role="img"
      aria-label={`Sunset score ${score} out of 100: ${label}`}
    >
      <svg viewBox="0 0 100 100" className="size-full -rotate-90">
        <circle cx="50" cy="50" r={RADIUS} fill="none" stroke="rgba(255,255,255,0.2)" strokeWidth="8" />
        <circle
          cx="50"
          cy="50"
          r={RADIUS}
          fill="none"
          stroke="#fff7ec"
          strokeWidth="8"
          strokeLinecap="round"
          strokeDasharray={CIRCUMFERENCE}
          strokeDashoffset={CIRCUMFERENCE * (1 - score / 100)}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-4xl leading-none font-semibold tabular-nums">{score}</span>
        <span className="mt-1 text-[10px] tracking-[0.16em] text-white/75 uppercase">of 100</span>
      </div>
    </div>
  );
}
