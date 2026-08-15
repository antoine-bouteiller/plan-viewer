export const Meter = ({ value, tone }: { value: number; tone?: string }) => (
  <span className="bg-hover inline-block h-1 w-14 overflow-hidden rounded-full align-middle">
    <span className="block h-full rounded-full" style={{ background: tone ?? 'var(--accent)', width: `${value * 100}%` }} />
  </span>
)
