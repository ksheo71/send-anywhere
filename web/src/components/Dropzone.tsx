import { useRef, useState } from 'react'
import { Upload } from 'lucide-react'
import { cn } from '@/lib/utils'

export function Dropzone({ onFiles, disabled }: { onFiles: (files: File[]) => void; disabled?: boolean }) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [over, setOver] = useState(false)

  function pick(list: FileList | null) {
    if (list && list.length) onFiles(Array.from(list))
  }

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => !disabled && inputRef.current?.click()}
      onKeyDown={(e) => { if ((e.key === 'Enter' || e.key === ' ') && !disabled) inputRef.current?.click() }}
      onDragOver={(e) => { e.preventDefault(); if (!disabled) setOver(true) }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); if (!disabled) pick(e.dataTransfer.files) }}
      className={cn(
        'flex cursor-pointer flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed p-10 text-center transition-colors',
        over ? 'border-primary bg-primary/5' : 'border-input hover:border-primary/50',
        disabled && 'pointer-events-none opacity-50',
      )}
    >
      <Upload className="size-8 text-muted-foreground" />
      <div>
        <p className="font-medium">여기로 파일을 끌어다 놓거나 클릭</p>
        <p className="text-sm text-muted-foreground">여러 파일도 한 번에</p>
      </div>
      <input
        ref={inputRef}
        type="file"
        multiple
        hidden
        onChange={(e) => { pick(e.target.files); e.target.value = '' }}
      />
    </div>
  )
}
