import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { AlertCircle, CheckCircle2, FileText, Loader2, MoreVertical, Play, Settings, Trash2, Upload } from 'lucide-react';
import { useBooks, useDeleteBook, useUploadBook } from '@/api/books';
import { useStartExtraction } from '@/api/extraction';
import { useLlmStatus } from '@/api/llm';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { FileDropzone } from '@/components/upload/FileDropzone';
import { BookStatusBadge } from '@/components/StatusBadge';
import { getExtractionStartGate } from '@/lib/extractionGate';
import { formatBytes, formatDate } from '@/lib/utils';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import type { Book } from '@/types';

export function LibraryPage() {
  const [showUpload, setShowUpload] = useState(false);
  const navigate = useNavigate();
  const booksQ = useBooks();
  const upload = useUploadBook();

  const onFile = async (file: File) => {
    try {
      const book = await upload.mutateAsync(file);
      toast.success(`已上传《${book.title}》`, {
        action: { label: '立即提取', onClick: () => navigate(`/books/${book.id}/pipeline?autostart=1`) },
      });
      setShowUpload(false);
    } catch (e) {
      toast.error(`上传失败：${(e as Error).message}`);
    }
  };

  const books = booksQ.data ?? [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">书库</h1>
          <p className="text-sm text-muted-foreground">上传小说 TXT，触发管道提取角色/场景/道具</p>
        </div>
        <Button onClick={() => setShowUpload((v) => !v)} className="gap-2">
          <Upload className="h-4 w-4" />
          {showUpload ? '关闭上传区' : '上传书籍'}
        </Button>
      </div>

      {showUpload && (
        <Card className="p-4">
          <FileDropzone onFile={onFile} disabled={upload.isPending} />
          {upload.isPending && (
            <p className="mt-3 flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              上传中…
            </p>
          )}
        </Card>
      )}

      {booksQ.isLoading ? (
        <p className="text-sm text-muted-foreground">加载中…</p>
      ) : books.length === 0 ? (
        <EmptyState onUpload={() => setShowUpload(true)} />
      ) : (
        <div className="grid gap-3">
          {books.map((b) => (
            <BookRow key={b.id} book={b} />
          ))}
        </div>
      )}
    </div>
  );
}

function EmptyState({ onUpload }: { onUpload: () => void }) {
  return (
    <Card className="flex flex-col items-center gap-3 p-10 text-center">
      <FileText className="h-10 w-10 text-muted-foreground" />
      <p className="text-sm text-muted-foreground">还没有书籍，先上传一本 TXT 试试</p>
      <Button onClick={onUpload} variant="outline">
        <Upload className="mr-2 h-4 w-4" />
        上传书籍
      </Button>
    </Card>
  );
}

function BookRow({ book }: { book: Book }) {
  const navigate = useNavigate();
  const del = useDeleteBook();
  const start = useStartExtraction(book.id);
  const llm = useLlmStatus();

  const extractionGate = getExtractionStartGate(llm.data, llm.isLoading);
  const isRunning = book.status === 'EXTRACTING';
  // 已成功提取过的书禁止在列表里重复触发；如需重新提取，去该书「管道」页二次确认。
  const isExtracted = book.status === 'EXTRACTED';

  const handleStart = async () => {
    if (!extractionGate.canStart) {
      toast.error(extractionGate.title ?? 'LLM Provider 未配置', {
        description: extractionGate.description,
        action: extractionGate.actionLabel
          ? { label: extractionGate.actionLabel, onClick: () => navigate('/settings/llm') }
          : undefined,
      });
      return;
    }
    try {
      await start.mutateAsync();
      toast.success('已开始提取');
      navigate(`/books/${book.id}/pipeline`);
    } catch (e) {
      toast.error(`触发失败：${(e as Error).message}`);
    }
  };

  const handleDelete = async () => {
    try {
      await del.mutateAsync(book.id);
      toast.success(`已删除《${book.title}》`);
    } catch (e) {
      toast.error(`删除失败：${(e as Error).message}`);
    }
  };

  return (
    <Card className="flex items-center gap-4 p-4">
      <FileText className="h-6 w-6 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <button
          onClick={() => navigate(`/books/${book.id}`)}
          className="block truncate text-left text-sm font-medium hover:underline"
        >
          {book.title}
        </button>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {formatBytes(book.fileSize)} · 上传于 {formatDate(book.createdAt)}
        </p>
      </div>
      <BookStatusBadge status={book.status} />
      <div className="flex items-center gap-1">
        {!extractionGate.canStart && extractionGate.reason === 'llm-not-configured' && (
          <Button variant="secondary" size="sm" onClick={() => navigate('/settings/llm')} className="gap-1">
            <Settings className="h-3.5 w-3.5" />
            设置
          </Button>
        )}
        <Button
          variant="outline"
          size="sm"
          onClick={handleStart}
          disabled={isRunning || isExtracted || start.isPending || !extractionGate.canStart}
          title={
            isExtracted
              ? '已提取完成；如需重新提取，请打开该书「管道」页'
              : !extractionGate.canStart
                ? extractionGate.description
                : undefined
          }
          className="gap-1"
        >
          {isRunning || start.isPending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : isExtracted ? (
            <CheckCircle2 className="h-3.5 w-3.5" />
          ) : extractionGate.canStart ? (
            <Play className="h-3.5 w-3.5" />
          ) : (
            <AlertCircle className="h-3.5 w-3.5" />
          )}
          {isRunning
            ? '进行中'
            : isExtracted
              ? '已提取'
              : extractionGate.canStart
                ? '提取'
                : extractionGate.buttonLabel}
        </Button>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              disabled={isRunning}
              aria-label={`删除《${book.title}》`}
            >
              <Trash2 className="h-4 w-4 text-destructive" />
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>删除《{book.title}》?</AlertDialogTitle>
              <AlertDialogDescription>
                将级联删除该书的所有角色/场景/道具，以及磁盘上的原始文件。此操作不可恢复。
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>取消</AlertDialogCancel>
              <AlertDialogAction onClick={handleDelete} className="bg-destructive hover:bg-destructive/90">
                确认删除
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => navigate(`/books/${book.id}`)}
          aria-label={`打开《${book.title}》详情`}
        >
          <MoreVertical className="h-4 w-4" />
        </Button>
      </div>
    </Card>
  );
}
