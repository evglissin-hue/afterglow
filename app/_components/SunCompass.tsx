/** A small compass with an arrow toward the setting sun. */
export function SunCompass({ bearing }: { bearing: number }) {
  return (
    <svg viewBox="0 0 48 48" className="size-12 shrink-0" aria-hidden="true">
      <circle cx="24" cy="24" r="21" fill="rgba(255,255,255,0.04)" stroke="rgba(255,255,255,0.16)" />
      <text x="24" y="11" textAnchor="middle" fontSize="7" fill="#8a8194">
        N
      </text>
      <g transform={`rotate(${bearing} 24 24)`}>
        <line x1="24" y1="24" x2="24" y2="9" stroke="#f08a3c" strokeWidth="2.5" strokeLinecap="round" />
        <circle cx="24" cy="8" r="3.5" fill="#ffc35c" />
      </g>
      <circle cx="24" cy="24" r="2" fill="#f6efe7" />
    </svg>
  );
}
