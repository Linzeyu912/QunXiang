import { useCallback, useRef, useState } from 'react';
import { UploadCloud } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Props {
  onFile: (file: File) => void;
  disabled?: boolean;
  accept?: string;
  maxSizeMB?: number;
}

export function FileDropzone({ onFile, disabled, accept = '.txt,text/plain', maxSizeMB = 50 }: Props) {
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const validate = useCallback(
    (file: File) => {
      if (maxSizeMB && file.size > maxSizeMB * 1024 * 1024) {
        setError(`文件过大（${(file.size / 1024 / 1024).toFixed(1)}MB > ${maxSizeMB}MB）`);
        return false;
      }
      setError(null);
      return true;
    },
    [maxSizeMB],
  );

  const handleFiles = useCallback(
    (files: FileList | null) => {
      if (!files || !files[0]) return;
      const file = files[0];
      if (!validate(file)) return;
      onFile(file);
    },
    [onFile, validate],
  );

  return (
    <div
      role="button"
      tabIndex={disabled ? -1 : 0}
      aria-label="上传 TXT 文件，拖拽或按回车 / 空格选择"
      aria-disabled={disabled}
      onDragOver={(e) => {
        e.preventDefault();
        if (!disabled) setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        if (disabled) return;
        handleFiles(e.dataTransfer.files);
      }}
      onClick={() => !disabled && inputRef.current?.click()}
      onKeyDown={(e) => {
        if (disabled) return;
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          inputRef.current?.click();
        }
      }}
      className={cn(
        'flex flex-col items-center justify-center rounded-lg border-2 border-dashed p-8 text-sm transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
        dragging ? 'border-primary bg-primary/5' : 'border-muted-foreground/25',
        disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer hover:border-primary/50',
      )}
    >
      <UploadCloud className="mb-3 h-8 w-8 text-muted-foreground" />
      <p className="text-foreground">拖拽 TXT 文件到此处，或点击选择</p>
      <p className="mt-1 text-xs text-muted-foreground">
        支持 UTF-8 / GBK / GB18030 · 单文件最大 {maxSizeMB}MB
      </p>
      {error && <p className="mt-3 text-xs text-destructive">{error}</p>}
      <input
        ref={inputRef}
        type="file"
        className="hidden"
        accept={accept}
        onChange={(e) => handleFiles(e.target.files)}
      />
    </div>
  );
}
