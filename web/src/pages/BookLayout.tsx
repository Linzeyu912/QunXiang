import { NavLink, Outlet, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, BookOpen, Boxes, Clapperboard, Download, FileText, ListTree, MapPin, Users, Workflow } from 'lucide-react';
import { useBook } from '@/api/books';
import { useStages } from '@/api/extraction';
import { useStories } from '@/api/stories';
import { Button } from '@/components/ui/button';
import { BookStatusBadge } from '@/components/StatusBadge';
import { formatBytes } from '@/lib/utils';
import { cn } from '@/lib/utils';

export function BookLayout() {
  const { bookId = '' } = useParams();
  const navigate = useNavigate();
  const bookQ = useBook(bookId);
  const stagesQ = useStages(bookId);
  const storiesQ = useStories(bookId);

  const book = bookQ.data;
  const isComplete = stagesQ.data?.isComplete ?? false;
  const pendingBoundaryReviews = storiesQ.data?.pendingBoundaryReviews ?? 0;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => navigate('/library')} aria-label="返回书库">
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
            <h1 className="truncate text-lg font-semibold">{book?.title ?? '加载中…'}</h1>
            {book && <BookStatusBadge status={book.status} />}
          </div>
          {book && (
            <p className="text-xs text-muted-foreground">
              {formatBytes(book.fileSize)} · ID {book.id.slice(0, 8)}
            </p>
          )}
        </div>
      </div>

      <div className="flex items-center gap-1 border-b">
        <BookTab to={`/books/${bookId}/pipeline`} icon={<Workflow className="h-4 w-4" />}>
          管道
        </BookTab>
        {/* 章节结构来自实时解析，不依赖提取完成 */}
        <BookTab to={`/books/${bookId}/chapters`} icon={<ListTree className="h-4 w-4" />}>
          章节
        </BookTab>
        <BookTab
          to={`/books/${bookId}/characters`}
          icon={<Users className="h-4 w-4" />}
          disabled={!isComplete}
        >
          角色
        </BookTab>
        <BookTab
          to={`/books/${bookId}/locations`}
          icon={<MapPin className="h-4 w-4" />}
          disabled={!isComplete}
        >
          场景
        </BookTab>
        <BookTab
          to={`/books/${bookId}/items`}
          icon={<Boxes className="h-4 w-4" />}
          disabled={!isComplete}
        >
          道具
        </BookTab>
        <BookTab
          to={`/books/${bookId}/export`}
          icon={<Download className="h-4 w-4" />}
          disabled={!isComplete}
        >
          导出
        </BookTab>
        {/* 故事管线独立于实体提取管线，不受 isComplete 门禁 */}
        <BookTab to={`/books/${bookId}/stories`} icon={<BookOpen className="h-4 w-4" />}>
          故事
          {pendingBoundaryReviews > 0 && (
            <span className="ml-1 rounded-full bg-red-500 px-1.5 text-[10px] leading-4 text-white">
              {pendingBoundaryReviews}
            </span>
          )}
        </BookTab>
        <BookTab to={`/books/${bookId}/director`} icon={<Clapperboard className="h-4 w-4" />}>
          导演
        </BookTab>
      </div>

      <Outlet />
    </div>
  );
}

function BookTab({
  to,
  icon,
  children,
  disabled,
}: {
  to: string;
  icon: React.ReactNode;
  children: React.ReactNode;
  disabled?: boolean;
}) {
  if (disabled) {
    return (
      <span
        className="flex items-center gap-1.5 px-3 py-2 text-sm text-muted-foreground/50"
        title="等待提取完成"
      >
        {icon}
        {children}
      </span>
    );
  }
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        cn(
          'flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm transition-colors',
          isActive
            ? 'border-primary text-foreground'
            : 'border-transparent text-muted-foreground hover:text-foreground',
        )
      }
    >
      {icon}
      {children}
    </NavLink>
  );
}
