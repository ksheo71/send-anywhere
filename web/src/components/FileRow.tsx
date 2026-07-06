import { AlertCircle, CheckCircle2, File as FileIcon, Loader2, X } from 'lucide-react'
import { Progress } from '@/components/ui/progress'
import { fmtSize } from '@/lib/format'

export type UploadStatus = 'queued' | 'uploading' | 'done' | 'error'

function StatusIcon({ status }: { status: UploadStatus }) {
  if (status === 'uploading') return <Loader2 className="size-4 shrink-0 animate-spin text-primary" />
  if (status === 'done') return <CheckCircle2 className="size-4 shrink-0 text-primary" />
  if (status === 'error') return <AlertCircle className="size-4 shrink-0 text-destructive" />
  return <FileIcon className="size-4 shrink-0 text-muted-foreground" />
}

export function FileRow({
  name, size, status, progress, onRemove,
}: {
  name: string
  size: number
  status: UploadStatus
  progress: number
  onRemove?: () => void
}) {
  return (
    <li className="flex flex-col gap-1 rounded-md border px-3 py-2 text-sm">
      <div className="flex items-center gap-3">
        <StatusIcon status={status} />
        <span className="flex-1 truncate">{name}</span>
        <span className="text-muted-foreground">{fmtSize(size)}</span>
        {onRemove && (
          <button aria-label="제거" onClick={onRemove}>
            <X className="size-4 text-muted-foreground hover:text-foreground" />
          </button>
        )}
      </div>
      {status === 'uploading' && (
        <div className="flex items-center gap-2">
          <Progress value={progress} className="h-1.5" />
          <span className="w-9 text-right text-xs text-muted-foreground">{progress}%</span>
        </div>
      )}
    </li>
  )
}
