export function RadarMark({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      <circle cx="16" cy="16" r="14" stroke="currentColor" strokeWidth="1.5" opacity="0.3" />
      <circle cx="16" cy="16" r="9" stroke="currentColor" strokeWidth="1" opacity="0.5" />
      <circle cx="16" cy="16" r="4" stroke="currentColor" strokeWidth="1" opacity="0.7" />
      <line x1="16" y1="16" x2="16" y2="2" stroke="currentColor" strokeWidth="1.5" opacity="0.8" />
      <circle cx="22" cy="10" r="2" fill="currentColor" className="text-radar-signal" />
      <circle cx="12" cy="20" r="1.5" fill="currentColor" opacity="0.6" />
    </svg>
  );
}
