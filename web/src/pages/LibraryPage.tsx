import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { Search, FileText, Eye, Trash2, Loader2, Grid3X3, List } from 'lucide-react';
import { api, type Book } from '../api/client';
import { useBookStore } from '../store';

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function statusBadge(status: string) {
  const map: Record<string, { text: string; cls: string }> = {
    UPLOADED: { text: '待提取', cls: 'bg-blue-100 text-blue-700' },
    EXTRACTING: { text: '提取中', cls: 'bg-yellow-100 text-yellow-700' },
    EXTRACTED: { text: '已提取', cls: 'bg-green-100 text-green-700' },
    FAILED: { text: '提取失败', cls: 'bg-red-100 text-red-700' },
  };
  return map[status] || { text: status, cls: 'bg-gray-100 text-gray-700' };
}

export default function LibraryPage() {
  const books = useBookStore((s) => s.books);
  const setBooks = useBookStore((s) => s.setBooks);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [viewMode, setViewMode] = useState<'list' | 'grid'>('list');
  const [viewingBook, setViewingBook] = useState<Book | null>(null);
  const [viewContent, setViewContent] = useState('');
  const [viewLoading, setViewLoading] = useState(false);

  const loadBooks = useCallback(async () => {
    setLoading(true);
    try {
      const { books } = await api.listBooks();
      setBooks(books);
    } catch (err) {
      console.error('Failed to load books:', err);
    } finally {
      setLoading(false);
    }
  }, [setBooks]);

  useEffect(() => {
    loadBooks();
  }, [loadBooks]);

  const handleView = async (book: Book) => {
    setViewingBook(book);
    setViewLoading(true);
    try {
      const { content } = await api.getBookContent(book.id);
      setViewContent(content.slice(0, 5000) + (content.length > 5000 ? '\n\n...（内容过长，仅展示前 5000 字）' : ''));
    } catch (err) {
      console.error('Failed to load content:', err);
      setViewContent('加载失败');
    } finally {
      setViewLoading(false);
    }
  };

  const handleDelete = async (book: Book) => {
    if (!confirm(`确定删除《${book.title}》？\n此操作不可撤销。`)) return;
    try {
      await api.deleteBook(book.id);
      useBookStore.getState().removeBook(book.id);
    } catch (err) {
      console.error('Delete failed:', err);
      alert('删除失败');
    }
  };

  const filtered = books.filter((book) => {
    const matchSearch = book.title.toLowerCase().includes(search.toLowerCase());
    const matchStatus = statusFilter === 'all' || book.status === statusFilter;
    return matchSearch && matchStatus;
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-[#0F172A] mb-1">书库</h1>
        <p className="text-[#64748B] text-sm">管理已上传的小说，查看提取状态和结果</p>
      </div>

      <div className="flex flex-col sm:flex-row gap-3 items-center">
        <div className="relative flex-1 w-full">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#94A3B8]" />
          <input
            type="text"
            placeholder="搜索书名..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-4 py-2.5 bg-white border border-gray-200 rounded-lg text-sm text-[#0F172A] placeholder:text-[#94A3B8] focus:outline-none focus:ring-2 focus:ring-[#3B82F6]/20 focus:border-[#3B82F6] transition-all"
          />
        </div>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="px-3 py-2.5 bg-white border border-gray-200 rounded-lg text-sm text-[#334155] focus:outline-none focus:ring-2 focus:ring-[#3B82F6]/20 focus:border-[#3B82F6]"
        >
          <option value="all">全部状态</option>
          <option value="UPLOADED">待提取</option>
          <option value="EXTRACTING">提取中</option>
          <option value="EXTRACTED">已提取</option>
          <option value="FAILED">提取失败</option>
        </select>
        <div className="flex bg-white border border-gray-200 rounded-lg overflow-hidden">
          <button
            onClick={() => setViewMode('list')}
            className={`p-2.5 transition-colors ${viewMode === 'list' ? 'bg-[#EFF6FF] text-[#2563EB]' : 'text-[#94A3B8] hover:text-[#64748B]'}`}
          >
            <List size={18} />
          </button>
          <button
            onClick={() => setViewMode('grid')}
            className={`p-2.5 transition-colors ${viewMode === 'grid' ? 'bg-[#EFF6FF] text-[#2563EB]' : 'text-[#94A3B8] hover:text-[#64748B]'}`}
          >
            <Grid3X3 size={18} />
          </button>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-6 h-6 text-[#94A3B8] animate-spin" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 bg-white rounded-xl border border-gray-100">
          <FileText className="w-10 h-10 text-gray-300 mx-auto mb-3" />
          <p className="text-[#94A3B8] text-sm">没有找到符合条件的书籍</p>
        </div>
      ) : viewMode === 'list' ? (
        <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-gray-100 text-xs text-[#94A3B8] uppercase tracking-wider">
                <th className="px-5 py-3 font-medium">书名</th>
                <th className="px-5 py-3 font-medium">大小</th>
                <th className="px-5 py-3 font-medium">状态</th>
                <th className="px-5 py-3 font-medium">上传日期</th>
                <th className="px-5 py-3 font-medium text-right">操作</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((book) => {
                const badge = statusBadge(book.status);
                return (
                  <tr key={book.id} className="border-b border-gray-50 hover:bg-[#F8FAFC] transition-colors">
                    <td className="px-5 py-3.5">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-lg bg-[#F1F5F9] flex items-center justify-center flex-shrink-0">
                          <FileText className="w-4 h-4 text-[#94A3B8]" />
                        </div>
                        <span className="font-medium text-[#0F172A] text-sm">{book.title}</span>
                      </div>
                    </td>
                    <td className="px-5 py-3.5 text-sm text-[#64748B]">{formatSize(book.fileSize)}</td>
                    <td className="px-5 py-3.5">
                      <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${badge.cls}`}>
                        {badge.text}
                      </span>
                    </td>
                    <td className="px-5 py-3.5 text-sm text-[#64748B]">
                      {new Date(book.createdAt).toLocaleDateString()}
                    </td>
                    <td className="px-5 py-3.5 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={() => handleView(book)}
                          className="p-1.5 rounded-lg text-[#94A3B8] hover:bg-[#F1F5F9] hover:text-[#64748B] transition-colors"
                          title="查看内容"
                        >
                          <Eye size={16} />
                        </button>
                        {book.status === 'EXTRACTED' && (
                          <Link
                            to={`/review/${book.id}`}
                            className="px-3 py-1.5 rounded-lg text-xs font-medium bg-[#EFF6FF] text-[#1D4ED8] hover:bg-[#DBEAFE] transition-colors"
                          >
                            审核
                          </Link>
                        )}
                        <button
                          onClick={() => handleDelete(book)}
                          className="p-1.5 rounded-lg text-[#94A3B8] hover:bg-red-50 hover:text-red-500 transition-colors"
                          title="删除"
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((book) => {
            const badge = statusBadge(book.status);
            return (
              <div key={book.id} className="bg-white rounded-xl border border-gray-100 p-5 hover:shadow-md transition-shadow">
                <div className="flex items-start justify-between mb-3">
                  <div className="w-10 h-10 rounded-lg bg-[#F1F5F9] flex items-center justify-center">
                    <FileText className="w-5 h-5 text-[#94A3B8]" />
                  </div>
                  <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${badge.cls}`}>
                    {badge.text}
                  </span>
                </div>
                <h3 className="font-medium text-[#0F172A] text-sm mb-1 truncate">{book.title}</h3>
                <p className="text-xs text-[#94A3B8] mb-4">
                  {formatSize(book.fileSize)} · {new Date(book.createdAt).toLocaleDateString()}
                </p>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => handleView(book)}
                    className="flex-1 px-3 py-1.5 rounded-lg text-xs font-medium border border-gray-200 text-[#64748B] hover:bg-[#F8FAFC] transition-colors"
                  >
                    查看
                  </button>
                  {book.status === 'EXTRACTED' && (
                    <Link
                      to={`/review/${book.id}`}
                      className="flex-1 px-3 py-1.5 rounded-lg text-xs font-medium bg-[#EFF6FF] text-[#1D4ED8] hover:bg-[#DBEAFE] transition-colors text-center"
                    >
                      审核
                    </Link>
                  )}
                  <button
                    onClick={() => handleDelete(book)}
                    className="p-1.5 rounded-lg text-[#94A3B8] hover:bg-red-50 hover:text-red-500 transition-colors"
                    title="删除"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {viewingBook && (
        <div
          className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4"
          onClick={() => setViewingBook(null)}
        >
          <div
            className="bg-white rounded-xl shadow-2xl max-w-3xl w-full max-h-[80vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
              <h3 className="text-lg font-semibold text-[#0F172A]">{viewingBook.title}</h3>
              <button
                onClick={() => setViewingBook(null)}
                className="text-[#94A3B8] hover:text-[#64748B] text-xl transition-colors"
              >
                ×
              </button>
            </div>
            <div className="flex-1 overflow-auto px-6 py-4">
              {viewLoading ? (
                <div className="flex items-center justify-center py-10">
                  <Loader2 className="w-5 h-5 text-[#94A3B8] animate-spin" />
                </div>
              ) : (
                <pre className="whitespace-pre-wrap font-mono text-sm text-[#334155] leading-relaxed">
                  {viewContent}
                </pre>
              )}
            </div>
            <div className="px-6 py-4 border-t border-gray-100 flex justify-end gap-2">
              <button
                onClick={() => setViewingBook(null)}
                className="px-4 py-2 rounded-lg text-sm font-medium border border-gray-200 text-[#64748B] hover:bg-[#F8FAFC] transition-colors"
              >
                关闭
              </button>
              {viewingBook.status === 'EXTRACTED' && (
                <Link
                  to={`/review/${viewingBook.id}`}
                  onClick={() => setViewingBook(null)}
                  className="px-4 py-2 rounded-lg text-sm font-medium bg-[#2563EB] text-white hover:bg-[#1D4ED8] transition-colors"
                >
                  去审核
                </Link>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
