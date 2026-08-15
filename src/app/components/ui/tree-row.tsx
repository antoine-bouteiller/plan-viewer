import { cn } from '@/lib/utils'

export const treeRowClass = (current?: boolean) =>
  cn(
    'flex w-full cursor-pointer items-center gap-1.5 rounded-[3px] border-l-2 border-transparent px-1.5 py-1 text-left text-[13px] text-fg hover:bg-hover',
    current && 'border-l-accent bg-accent-soft'
  )

export const TreeRow = ({ current, className, ...props }: React.ComponentProps<'button'> & { current?: boolean }) => (
  <button type="button" className={cn(treeRowClass(current), className)} {...props} />
)

export const RowName = ({ current, className, ...props }: React.ComponentProps<'span'> & { current?: boolean }) => (
  <span className={cn('min-w-0 flex-1 truncate text-left', current && 'font-semibold', className)} {...props} />
)
