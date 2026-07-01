import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, Link } from 'react-router-dom';
import {
  ChevronLeft,
  Users,
  MapPin,
  Package,
  Keyboard,
  Eye,
  Quote,
} from 'lucide-react';
import { api, type Character, type Location, type Item, type Book } from '../api/client';
import { EntityCard } from '../components/EntityCard';

type FilterStatus = 'all' | 'PENDING' | 'APPROVED' | 'REJECTED';
type EntityTab = 'character' | 'location' | 'item';

const TAB_CONFIG: { key: EntityTab; label: string; icon: React.ElementType }[] = [
  { key: 'character', label: '角色', icon: Users },
  { key: 'location', label: '地点', icon: MapPin },
  { key: 'item', label: '道具', icon: Package },
];

function StatusFilter({
  filter,
  onChange,
  counts,
}: {
  filter: FilterStatus;
  onChange: (f: FilterStatus) => void;
  counts: Record<FilterStatus, number>;
}) {
  const items: { key: FilterStatus; label: string }[] = [
    { key: 'all', label: '全部' },
    { key: 'PENDING', label: '待审核' },
    { key: 'APPROVED', label: '已通过' },
    { key: 'REJECTED', label: '已拒绝' },
  ];
  return (
    <div className="flex gap-2">
      {items.map((item) => (
        <button
          key={item.key}
          onClick={() => onChange(item.key)}
          className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all duration-200 ${
            filter === item.key
              ? 'bg-[#0F172A] text-white shadow-sm'
              : 'bg-white text-[#64748B] border border-gray-200 hover:border-gray-300'
          }`}
        >
          {item.label}
          <span className="ml-1.5 text-xs opacity-70">{counts[item.key]}</span>
        </button>
      ))}
    </div>
  );
}

function EntityTabBar({
  activeTab,
  onChange,
  counts,
}: {
  activeTab: EntityTab;
  onChange: (tab: EntityTab) => void;
  counts: Record<EntityTab, number>;
}) {
  return (
    <div className="flex gap-1 bg-[#F1F5F9] p-1 rounded-lg w-fit">
      {TAB_CONFIG.map(({ key, label, icon: Icon }) => (
        <button
          key={key}
          onClick={() => onChange(key)}
          className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-all duration-200 ${
            activeTab === key
              ? 'bg-white text-[#0F172A] shadow-sm'
              : 'text-[#64748B] hover:text-[#334155]'
          }`}
        >
          <Icon size={16} />
          {label}
          <span className={`text-xs px-1.5 py-0.5 rounded-full ${
            activeTab === key ? 'bg-[#0F172A] text-white' : 'bg-gray-200 text-gray-600'
          }`}>
            {counts[key]}
          </span>
        </button>
      ))}
    </div>
  );
}

export default function ReviewPage() {
  const { bookId } = useParams<{ bookId: string }>();
  const [characters, setCharacters] = useState<Character[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [book, setBook] = useState<Book | null>(null);
  const [activeTab, setActiveTab] = useState<EntityTab>('character');
  const [filter, setFilter] = useState<FilterStatus>('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [content, setContent] = useState('');
  const [showSource, setShowSource] = useState(false);
  const entityRefs = useRef<Record<string, HTMLDivElement | null>>({});

  const loadData = useCallback(async () => {
    if (!bookId) return;
    setLoading(true);
    setError(null);
    try {
      const [{ book }, { characters }, { locations }, { items }, { content: c }] = await Promise.all([
        api.getBook(bookId).catch((e) => { console.error('Failed to load book:', e); return { book: null }; }),
        api.listCharacters(bookId).catch((e) => { console.error('Failed to load characters:', e); return { characters: [] }; }),
        api.listLocations(bookId).catch((e) => { console.error('Failed to load locations:', e); return { locations: [] }; }),
        api.listItems(bookId).catch((e) => { console.error('Failed to load items:', e); return { items: [] }; }),
        api.getBookContent(bookId).catch((e) => { console.error('Failed to load content:', e); return { content: '' }; }),
      ]);
      if (!book) {
        setError('无法加载书籍信息，请返回书库重试');
      }
      setBook(book);
      setCharacters(characters);
      setLocations(locations);
      setItems(items);
      setContent(c);
    } catch (err) {
      console.error('Failed to load data:', err);
      setError('加载数据失败，请刷新页面重试');
    } finally {
      setLoading(false);
    }
  }, [bookId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Get current tab's entities
  const getCurrentEntities = useCallback(() => {
    switch (activeTab) {
      case 'character': return characters;
      case 'location': return locations;
      case 'item': return items;
    }
  }, [activeTab, characters, locations, items]);

  const setCurrentEntities = useCallback((updater: (prev: any[]) => any[]) => {
    switch (activeTab) {
      case 'character': setCharacters(updater); break;
      case 'location': setLocations(updater); break;
      case 'item': setItems(updater); break;
    }
  }, [activeTab]);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      const entities = getCurrentEntities();
      const pending = entities.filter((c) => c.status === 'PENDING');
      if (pending.length === 0) return;
      const current = pending[0];

      switch (e.key.toLowerCase()) {
        case 'a':
          e.preventDefault();
          handleApprove(current.id);
          break;
        case 'r':
          e.preventDefault();
          handleReject(current.id);
          break;
        case 'arrowdown':
          e.preventDefault();
          scrollToEntity(pending[1]?.id);
          break;
        case 'arrowup':
          e.preventDefault();
          scrollToEntity(pending[pending.length - 1]?.id);
          break;
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [getCurrentEntities]);

  const scrollToEntity = (id?: string) => {
    if (!id) return;
    const el = entityRefs.current[id];
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el.classList.add('ring-2', 'ring-[#3B82F6]', 'ring-offset-2');
      setTimeout(() => el.classList.remove('ring-2', 'ring-[#3B82F6]', 'ring-offset-2'), 1500);
    }
  };

  const getUpdateFn = () => {
    switch (activeTab) {
      case 'character': return api.updateCharacter.bind(api);
      case 'location': return api.updateLocation.bind(api);
      case 'item': return api.updateItem.bind(api);
    }
  };

  const handleApprove = async (id: string) => {
    try {
      const updateFn = getUpdateFn();
      await updateFn(id, { status: 'APPROVED' });
      setCurrentEntities((prev) => prev.map((c) => (c.id === id ? { ...c, status: 'APPROVED' } : c)));
    } catch (error) {
      console.error('Failed to approve:', error);
      alert('审核操作失败，请重试');
    }
  };

  const handleReject = async (id: string) => {
    try {
      const updateFn = getUpdateFn();
      await updateFn(id, { status: 'REJECTED' });
      setCurrentEntities((prev) => prev.map((c) => (c.id === id ? { ...c, status: 'REJECTED' } : c)));
    } catch (error) {
      console.error('Failed to reject:', error);
      alert('审核操作失败，请重试');
    }
  };

  const handleEdit = async (id: string, data: Partial<Character | Location | Item>) => {
    try {
      const updateFn = getUpdateFn();
      await updateFn(id, data);
      setCurrentEntities((prev) => prev.map((c) => (c.id === id ? { ...c, ...data } : c)));
    } catch (error) {
      console.error('Failed to edit:', error);
      alert('编辑操作失败，请重试');
    }
  };

  const handleBulkApprove = async () => {
    try {
      const updateFn = getUpdateFn();
      const ids = Array.from(selectedIds);
      await Promise.all(ids.map((id) => updateFn(id, { status: 'APPROVED' })));
      setCurrentEntities((prev) => prev.map((c) => (selectedIds.has(c.id) ? { ...c, status: 'APPROVED' } : c)));
      setSelectedIds(new Set());
    } catch (error) {
      console.error('Failed to bulk approve:', error);
      alert('批量审核操作失败，请重试');
    }
  };

  const handleBulkReject = async () => {
    try {
      const updateFn = getUpdateFn();
      const ids = Array.from(selectedIds);
      await Promise.all(ids.map((id) => updateFn(id, { status: 'REJECTED' })));
      setCurrentEntities((prev) => prev.map((c) => (selectedIds.has(c.id) ? { ...c, status: 'REJECTED' } : c)));
      setSelectedIds(new Set());
    } catch (error) {
      console.error('Failed to bulk reject:', error);
      alert('批量审核操作失败，请重试');
    }
  };

  const toggleSelection = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const currentEntities = getCurrentEntities();
  const filtered = currentEntities.filter((c) => filter === 'all' || c.status === filter);

  const tabCounts: Record<EntityTab, number> = {
    character: characters.length,
    location: locations.length,
    item: items.length,
  };

  const counts: Record<FilterStatus, number> = {
    all: currentEntities.length,
    PENDING: currentEntities.filter((c) => c.status === 'PENDING').length,
    APPROVED: currentEntities.filter((c) => c.status === 'APPROVED').length,
    REJECTED: currentEntities.filter((c) => c.status === 'REJECTED').length,
  };

  const totalEntities = characters.length + locations.length + items.length;
  const totalReviewed = characters.filter(c => c.status !== 'PENDING').length
    + locations.filter(l => l.status !== 'PENDING').length
    + items.filter(i => i.status !== 'PENDING').length;
  const completionRate = totalEntities > 0 ? Math.round(totalReviewed / totalEntities * 100) : 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link
            to="/library"
            className="p-2 rounded-lg text-[#94A3B8] hover:bg-[#F1F5F9] hover:text-[#64748B] transition-colors"
          >
            <ChevronLeft size={20} />
          </Link>
          <div>
            <h1 className="text-xl font-semibold text-[#0F172A]">{book?.title || '加载中...'}</h1>
            <p className="text-xs text-[#94A3B8] mt-0.5">
              {characters.length} 角色 · {locations.length} 地点 · {items.length} 物品 · 审核进度 {completionRate}%
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowSource(!showSource)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
              showSource ? 'bg-[#EFF6FF] text-[#1D4ED8]' : 'border border-gray-200 text-[#64748B] hover:bg-[#F8FAFC]'
            }`}
          >
            <Eye size={14} />
            原文对照
          </button>
          <button
            onClick={() => setShowShortcuts(!showShortcuts)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium border border-gray-200 text-[#64748B] hover:bg-[#F8FAFC] transition-colors"
          >
            <Keyboard size={14} />
            快捷键
          </button>
        </div>
      </div>

      {showShortcuts && (
        <div className="bg-[#F1F5F9] rounded-lg p-4 text-sm text-[#334155] space-y-1.5">
          <p className="font-medium text-[#0F172A] mb-2">键盘快捷键</p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <span><kbd className="px-1.5 py-0.5 bg-white rounded border text-xs font-mono">A</kbd> 通过当前</span>
            <span><kbd className="px-1.5 py-0.5 bg-white rounded border text-xs font-mono">R</kbd> 拒绝当前</span>
            <span><kbd className="px-1.5 py-0.5 bg-white rounded border text-xs font-mono">↓</kbd> 下一个</span>
            <span><kbd className="px-1.5 py-0.5 bg-white rounded border text-xs font-mono">↑</kbd> 上一个</span>
          </div>
        </div>
      )}

      <EntityTabBar activeTab={activeTab} onChange={(tab) => { setActiveTab(tab); setFilter('PENDING'); setSelectedIds(new Set()); }} counts={tabCounts} />

      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <StatusFilter filter={filter} onChange={setFilter} counts={counts} />
        {selectedIds.size > 0 && (
          <div className="flex items-center gap-2 animate-in fade-in slide-in-from-bottom-2">
            <span className="text-sm text-[#64748B]">已选 {selectedIds.size} 项</span>
            <button
              onClick={handleBulkApprove}
              className="px-3 py-1.5 rounded-lg text-sm font-medium bg-[#ECFDF5] text-green-700 hover:bg-green-100 transition-colors"
            >
              批量通过
            </button>
            <button
              onClick={handleBulkReject}
              className="px-3 py-1.5 rounded-lg text-sm font-medium bg-red-50 text-red-700 hover:bg-red-100 transition-colors"
            >
              批量拒绝
            </button>
            <button
              onClick={() => setSelectedIds(new Set())}
              className="px-3 py-1.5 rounded-lg text-sm font-medium border border-gray-200 text-[#64748B] hover:bg-[#F8FAFC] transition-colors"
            >
              清除
            </button>
          </div>
        )}
      </div>

      <div className="flex gap-6">
        {showSource && content && (
          <div className="w-80 flex-shrink-0 bg-white rounded-xl border border-gray-100 p-4 h-[calc(100vh-280px)] sticky top-8">
            <div className="flex items-center gap-2 mb-3 pb-3 border-b border-gray-50">
              <Quote size={16} className="text-[#94A3B8]" />
              <h3 className="text-sm font-semibold text-[#334155]">原文内容</h3>
            </div>
            <pre className="text-xs text-[#64748B] leading-relaxed whitespace-pre-wrap overflow-auto h-full font-mono">
              {content.slice(0, 8000)}
              {content.length > 8000 && '\n\n...（内容过长）'}
            </pre>
          </div>
        )}

        <div className="flex-1 space-y-4">
          {loading ? (
            <div className="flex items-center justify-center py-20">
              <div className="w-6 h-6 border-2 border-[#3B82F6] border-t-transparent rounded-full animate-spin" />
            </div>
          ) : error ? (
            <div className="text-center py-16 bg-white rounded-xl border border-red-100">
              <p className="text-red-500 text-sm mb-3">{error}</p>
              <button
                onClick={loadData}
                className="px-4 py-2 rounded-lg text-sm font-medium bg-red-50 text-red-700 hover:bg-red-100 transition-colors"
              >
                重试
              </button>
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-16 bg-white rounded-xl border border-gray-100">
              {activeTab === 'character' && <Users className="w-10 h-10 text-gray-300 mx-auto mb-3" />}
              {activeTab === 'location' && <MapPin className="w-10 h-10 text-gray-300 mx-auto mb-3" />}
              {activeTab === 'item' && <Package className="w-10 h-10 text-gray-300 mx-auto mb-3" />}
              <p className="text-[#94A3B8] text-sm">
                {filter === 'PENDING' ? `暂无待审核${activeTab === 'character' ? '角色' : activeTab === 'location' ? '地点' : '物品'}，太棒了！` : '该筛选条件下没有实体'}
              </p>
            </div>
          ) : (
            filtered.map((entity) => (
              <div key={entity.id} ref={(el) => { entityRefs.current[entity.id] = el; }}>
                <EntityCard
                  entity={entity}
                  entityType={activeTab}
                  onApprove={handleApprove}
                  onReject={handleReject}
                  onEdit={handleEdit}
                  isSelected={selectedIds.has(entity.id)}
                  onToggleSelect={toggleSelection}
                />
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
