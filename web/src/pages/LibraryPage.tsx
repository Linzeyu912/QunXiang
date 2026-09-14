import { memo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { AlertCircle, CheckCircle2, FileText, Loader2, MoreVertical, Play, Settings, Share, Trash2, Upload } from 'lucide-react';
import { useBooks, useDeleteBook, useUploadBook } from '@/api/books';
import { useStartExtraction } from '@/api/extraction';
import { ApiError } from '@/api/client';
import { useLlmStatus, useLlmProfiles } from '@/api/llm';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { FileDropzone } from '@/components/upload/FileDropzone';
import { BookStatusBadge } from '@/components/StatusBadge';
import { BookDownloadSection } from '@/components/BookDownloadSection';
import { ShareDialog } from '@/components/ShareDialog';
import { getExtractionStartGate } from '@/lib/extractionGate';
import { formatBytes, formatDate } from '@/lib/utils';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
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
  // 书架分区（实施包 B3）：我的项目 vs 体验示例（示例书标明为导入数据）
  const seedBooks = books.filter((b) => b.sourceType === 'SEED');
  const myBooks = books.filter((b) => b.sourceType !== 'SEED');

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
        <BookListSkeleton />
      ) : books.length === 0 ? (
        <EmptyState onUpload={() => setShowUpload(true)} />
      ) : (
        <>
          {myBooks.length > 0 && (
            <section className="space-y-2">
              <h2 className="text-sm font-semibold text-muted-foreground">我的项目</h2>
              <div className="grid gap-3">
                {myBooks.map((b) => (
                  <BookRow key={b.id} book={b} />
                ))}
              </div>
            </section>
          )}
          {seedBooks.length > 0 && (
            <section className="space-y-2">
              <h2 className="text-sm font-semibold text-muted-foreground">体验示例</h2>
              <p className="text-xs text-muted-foreground">
                示例数据 · 导入结果，未代表当前用户人工审核
              </p>
              <div className="grid gap-3">
                {seedBooks.map((b) => (
                  <BookRow key={b.id} book={b} isSeed />
                ))}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}

/** 书库加载骨架：按 BookRow 的真实布局占位，避免加载完成后页面跳动。 */
function BookListSkeleton() {
  return (
    <div className="grid gap-3" aria-label="书库加载中">
      {[0, 1, 2].map((i) => (
        <Card key={i} className="flex items-center gap-4 p-4">
          <Skeleton className="h-10 w-10 rounded-lg" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-2/5" />
            <Skeleton className="h-3 w-1/4" />
          </div>
          <Skeleton className="h-6 w-14" />
          <Skeleton className="h-8 w-20" />
        </Card>
      ))}
    </div>
  );
}

function EmptyState({ onUpload }: { onUpload: () => void }) {
  return (
    <Card className="flex flex-col items-center gap-3 border-dashed p-10 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-muted">
        <FileText className="h-7 w-7 text-muted-foreground" />
      </div>
      <div>
        <p className="text-sm font-medium">书库还是空的</p>
        <p className="mt-1 text-xs text-muted-foreground">上传一本 TXT 小说，开始提取角色/场景/道具</p>
      </div>
      <Button onClick={onUpload} variant="outline">
        <Upload className="mr-2 h-4 w-4" />
        上传书籍
      </Button>
    </Card>
  );
}

const BookRow = memo(function BookRow({ book, isSeed = false }: { book: Book; isSeed?: boolean }) {
  const navigate = useNavigate();
  const del = useDeleteBook();
  const [shareOpen, setShareOpen] = useState(false);
  const start = useStartExtraction(book.id);
  const llm = useLlmStatus();
  const profilesQ = useLlmProfiles();
  // 多档案时弹窗选择本书用哪个服务商；选中项默认跟随全局默认档案
  const [profilePickOpen, setProfilePickOpen] = useState(false);
  const [pickedProfileId, setPickedProfileId] = useState<string>('');

  const profiles = profilesQ.data?.profiles ?? [];
  const activeProfileId = profilesQ.data?.activeProfileId ?? '';

  const extractionGate = getExtractionStartGate(llm.data, llm.isLoading);
  const isRunning = book.status === 'EXTRACTING';
  const isSeedPreparing = book.status === 'SEED_PREPARING';
  // 已成功提取过的书禁止在列表里重复触发；如需重新提取，去该书「管道」页二次确认。
  const isExtracted = book.status === 'EXTRACTED';

  const doStart = async (providerProfileId?: string) => {
    try {
      await start.mutateAsync(providerProfileId ? { providerProfileId } : undefined);
      toast.success('已开始提取');
      navigate(`/books/${book.id}/pipeline`);
    } catch (e) {
      // 409 = 已有运行在进行：不是失败，直接带用户去看进度
      if (e instanceof ApiError && e.status === 409) {
        toast.info('该书正在提取中，已为你打开进度页');
        navigate(`/books/${book.id}/pipeline`);
        return;
      }
      toast.error(`触发失败：${(e as Error).message}`);
    }
  };

  const handleStart = async () => {
    if (!extractionGate.canStart) {
      toast.error(extractionGate.title ?? 'LLM 服务商未配置', {
        description: extractionGate.description,
        action: extractionGate.actionLabel
          ? { label: extractionGate.actionLabel, onClick: () => navigate('/settings/llm') }
          : undefined,
      });
      return;
    }
    // 只有一个档案（或档案列表未就绪）→ 直接用默认档案启动；
    // 多档案 → 弹窗让用户指定本书的服务商（多本书可各选各的并行）
    if (profiles.length > 1) {
      setPickedProfileId(activeProfileId || profiles[0].id);
      setProfilePickOpen(true);
      return;
    }
    await doStart();
  };

  const confirmProfilePick = async () => {
    setProfilePickOpen(false);
    await doStart(pickedProfileId || undefined);
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
    <Card className="flex flex-wrap items-center gap-x-4 gap-y-2 p-4 transition-shadow hover:shadow-md">
      {/* 书籍图标放进灰底方块，与顶栏品牌块的视觉语言一致 */}
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-muted">
        <FileText className="h-5 w-5 text-muted-foreground" />
      </div>
      <div className="min-w-0 flex-1 basis-48">
        <button
          onClick={() => navigate(`/books/${book.id}`)}
          className="block max-w-full truncate rounded-sm text-left text-sm font-medium hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {book.title}
        </button>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {formatBytes(book.fileSize)} · 上传于 {formatDate(book.createdAt)}
          {isSeed && ' · 示例数据（导入结果，未经人工审核）'}
        </p>
      </div>
      <BookStatusBadge status={book.status} />
      {book.status === 'EXTRACTED' && <BookDownloadSection bookId={book.id} />}
      <div className="flex flex-wrap items-center gap-1">
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
          disabled={isRunning || isExtracted || isSeedPreparing || start.isPending || !extractionGate.canStart}
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
              title="删除"
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
          onClick={() => setShareOpen(true)}
          disabled={book.status !== 'EXTRACTED'}
          aria-label={`分享《${book.title}》`}
          title={book.status !== 'EXTRACTED' ? '提取完成后才能分享' : '分享'}
        >
          <Share className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => navigate(`/books/${book.id}`)}
          aria-label={`打开《${book.title}》详情`}
          title="打开详情"
        >
          <MoreVertical className="h-4 w-4" />
        </Button>
      </div>
      {/* 多服务商档案选择：指定本书用哪个服务商提取（多本书可并行各用各的） */}
      <Dialog open={profilePickOpen} onOpenChange={setProfilePickOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>选择本次提取的服务商</DialogTitle>
            <DialogDescription>
              《{book.title}》将使用所选配置档案提取，运行期间固定不变。多本书可分别选择不同档案并行提取。
            </DialogDescription>
          </DialogHeader>
          <RadioGroup value={pickedProfileId} onValueChange={setPickedProfileId} className="gap-2">
            {profiles.map((profile) => (
              <Label
                key={profile.id}
                htmlFor={`profile-${profile.id}`}
                className={`flex cursor-pointer items-start gap-3 rounded-md border p-3 font-normal ${pickedProfileId === profile.id ? 'border-primary bg-primary/5' : ''}`}
              >
                <RadioGroupItem id={`profile-${profile.id}`} value={profile.id} className="mt-0.5" />
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-1.5 text-sm font-medium">
                    {profile.name}
                    {profile.isActive && <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] text-primary">默认</span>}
                  </span>
                  <span className="mt-0.5 block text-xs text-muted-foreground">
                    {profile.model || '未设置模型'} · {profile.keyCount} 个密钥
                    {profile.baseUrl ? ` · ${profile.baseUrl}` : ''}
                  </span>
                </span>
              </Label>
            ))}
          </RadioGroup>
          <DialogFooter>
            <Button variant="outline" onClick={() => setProfilePickOpen(false)}>取消</Button>
            <Button onClick={confirmProfilePick} disabled={start.isPending || !pickedProfileId}>
              {start.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              开始提取
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <ShareDialog bookId={book.id} bookTitle={book.title} open={shareOpen} onOpenChange={setShareOpen} />
    </Card>
  );
});
