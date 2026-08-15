import { useState } from 'react'

export const CopyChip = ({ label, value, title }: { label: string; value: string; title?: string }) => {
  const [copied, setCopied] = useState(false)

  return (
    <button
      type="button"
      title={title}
      className="bg-elevated text-muted hover:border-border-strong hover:text-fg cursor-pointer rounded-[3px] border px-1.5 py-px font-mono text-[10px]"
      onClick={() => {
        void navigator.clipboard.writeText(value).then(() => {
          setCopied(true)
          setTimeout(() => setCopied(false), 1200)
        })
      }}
    >
      {copied ? 'copied' : label}
    </button>
  )
}
