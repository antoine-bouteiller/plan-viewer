import { cn } from '@/lib/utils'

export const Select = ({ className, ...props }: React.ComponentProps<'select'>) => (
  <select className={cn('h-8 w-full rounded-md border bg-elevated px-2 text-[13px] outline-none', className)} {...props} />
)
