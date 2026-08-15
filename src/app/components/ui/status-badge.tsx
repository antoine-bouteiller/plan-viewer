import { statusToken, statusTone } from '@/lib/plan'
import { cn } from '@/lib/utils'

export const StatusBadge = ({ status, variant = 'badge' }: { status?: string; variant?: 'badge' | 'chip' }) => (
  <span
    className={cn(
      'inline-flex shrink-0 items-center rounded-[3px] border border-current px-1 font-mono font-semibold tracking-[0.02em] lowercase',
      'bg-[color-mix(in_srgb,var(--tone)_10%,transparent)] text-[var(--tone)]',
      variant === 'chip' ? 'text-[9px]/[1.4]' : 'text-[10px]/[1.5]',
      statusToken(status) === 'unknown' && 'border-dashed'
    )}
    style={{ '--tone': statusTone(status) } as React.CSSProperties}
    aria-label={`status: ${status ?? 'unknown'}`}
  >
    {status ?? 'unknown'}
  </span>
)
