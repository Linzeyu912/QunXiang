import { NavLink, Outlet, useNavigate, useParams } from 'react-router-dom';
import { Archive, ArrowLeft, Boxes, Download, FileText, Globe2, ListTree, MapPin, Users, Workflow } from 'lucide-react';
import { useBook } from '@/api/books';
import { useStages } from '@/api/extraction';
import { Button } from '@/components/ui/button';
import { BookStatusBadge } from '@/components/StatusBadge';
import { formatBytes } from '@/lib/utils';
import { cn } from '@/lib/utils';

export function BookLayout() {
  const { bookId = '' } = useParams();
  const navigate = useNavigate();
  const bookQ = useBook(bookId);
  const stagesQ = useStages(bookId);

  const book = bookQ.data;
  const isComplete = stagesQ.data?.isComplete ?? false;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
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

      <nav
        aria-label="书籍功能导航"
        className="flex items-center gap-1 overflow-x-auto border-b px-1 py-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
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
          to={`/books/${bookId}/worldview`}
          icon={<Globe2 className="h-4 w-4" />}
          disabled={!isComplete}
        >
          世界观
        </BookTab>
        <BookTab
          to={`/books/${bookId}/low-confidence`}
          icon={<Archive className="h-4 w-4" />}
          disabled={!isComplete}
        >
          低置信度库
        </BookTab>
        <BookTab
          to={`/books/${bookId}/export`}
          icon={<Download className="h-4 w-4" />}
          disabled={!isComplete}
        >
          导出
        </BookTab>
      </nav>

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
        className="flex shrink-0 items-center gap-1.5 whitespace-nowrap px-3 py-2 text-sm text-muted-foreground/50"
        title="等待提取完成"
        aria-disabled="true"
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
          'flex shrink-0 items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          isActive
            ? 'border-primary font-medium text-foreground'
            : 'border-transparent text-muted-foreground hover:text-foreground',
        )
      }
    >
      {icon}
      {children}
    </NavLink>
  );
}
