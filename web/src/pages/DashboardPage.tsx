import { useState, useEffect } from 'react';
import { BookOpen, Clock, TrendingUp, MapPin, Package, Layers } from 'lucide-react';
import { api, type Book, type Character, type Location, type Item } from '../api/client';

interface StatCardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  icon: React.ElementType;
  color: string;
  bgColor: string;
}

function StatCard({ title, value, subtitle, icon: Icon, color, bgColor }: StatCardProps) {
  return (
    <div className="bg-white rounded-xl border border-gray-100 p-5 hover:shadow-md transition-shadow duration-200">
      <div className="flex items-start justify-between mb-3">
        <div className={`w-10 h-10 rounded-lg ${bgColor} flex items-center justify-center`}>
          <Icon className={`w-5 h-5 ${color}`} />
        </div>
      </div>
      <p className="text-2xl font-bold text-[#0F172A] mb-0.5">{value}</p>
      <p className="text-sm text-[#64748B]">{title}</p>
      {subtitle && <p className="text-xs text-[#94A3B8] mt-1">{subtitle}</p>}
    </div>
  );
}

function StatusBar({ label, count, total, color }: { label: string; count: number; total: number; color: string }) {
  const pct = total > 0 ? (count / total) * 100 : 0;
  return (
    <div className="mb-3">
      <div className="flex items-center justify-between text-sm mb-1.5">
        <span className="text-[#334155]">{label}</span>
        <span className="text-[#64748B] font-medium">{count} ({pct.toFixed(0)}%)</span>
      </div>
      <div className="h-2 bg-[#F1F5F9] rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-500 ${color}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

export default function DashboardPage() {
  const [books, setBooks] = useState<Book[]>([]);
  const [characters, setCharacters] = useState<Character[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      try {
        const { books } = await api.listBooks();
        setBooks(books);
        const extractedBooks = books.filter((b) => b.status === 'EXTRACTED');
        if (extractedBooks.length > 0) {
          const [charResults, locResults, itemResults] = await Promise.all([
            Promise.all(extractedBooks.map((b) => api.listCharacters(b.id).catch(() => ({ characters: [] })))),
            Promise.all(extractedBooks.map((b) => api.listLocations(b.id).catch(() => ({ locations: [] })))),
            Promise.all(extractedBooks.map((b) => api.listItems(b.id).catch(() => ({ items: [] })))),
          ]);
          setCharacters(charResults.flatMap((r) => r.characters));
          setLocations(locResults.flatMap((r) => r.locations));
          setItems(itemResults.flatMap((r) => r.items));
        }
      } catch (err) {
        console.error('Failed to load dashboard data:', err);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  const extractedBooks = books.filter((b) => b.status === 'EXTRACTED');
  const pendingBooks = books.filter((b) => b.status === 'UPLOADED' || b.status === 'FAILED');
  const extractingBooks = books.filter((b) => b.status === 'EXTRACTING');

  const approvedChars = characters.filter((c) => c.status === 'APPROVED');
  const pendingChars = characters.filter((c) => c.status === 'PENDING');
  const rejectedChars = characters.filter((c) => c.status === 'REJECTED');

  const avgConfidence = characters.length > 0
    ? (characters.reduce((sum, c) => sum + c.confidence, 0) / characters.length * 100).toFixed(1)
    : '0';

  const allEntities = [...characters, ...locations, ...items];
  const totalEntities = allEntities.length;

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-6 h-6 border-2 border-[#3B82F6] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold text-[#0F172A] mb-1">仪表盘</h1>
        <p className="text-[#64748B] text-sm">概览小说提取与实体审核的整体状态</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          title="总书籍数"
          value={books.length}
          subtitle={`${extractedBooks.length} 本已提取`}
          icon={BookOpen}
          color="text-[#2563EB]"
          bgColor="bg-[#EFF6FF]"
        />
        <StatCard
          title="总实体数"
          value={totalEntities}
          subtitle={`${characters.length} 角色 · ${locations.length} 地点 · ${items.length} 物品`}
          icon={Layers}
          color="text-[#10B981]"
          bgColor="bg-[#ECFDF5]"
        />
        <StatCard
          title="地点实体"
          value={locations.length}
          subtitle={`${locations.filter((l) => l.tier === 'core').length} 个核心`}
          icon={MapPin}
          color="text-[#F59E0B]"
          bgColor="bg-[#FFFBEB]"
        />
        <StatCard
          title="物品实体"
          value={items.length}
          subtitle={`${items.filter((i) => i.tier === 'core').length} 个核心`}
          icon={Package}
          color="text-[#8B5CF6]"
          bgColor="bg-[#F5F3FF]"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white rounded-xl border border-gray-100 p-6">
          <h2 className="text-lg font-semibold text-[#0F172A] mb-5">书籍状态分布</h2>
          {books.length === 0 ? (
            <p className="text-[#94A3B8] text-sm py-4">暂无数据</p>
          ) : (
            <>
              <StatusBar label="已提取" count={extractedBooks.length} total={books.length} color="bg-green-500" />
              <StatusBar label="提取中" count={extractingBooks.length} total={books.length} color="bg-yellow-500" />
              <StatusBar label="待提取 / 失败" count={pendingBooks.length} total={books.length} color="bg-blue-500" />
            </>
          )}
        </div>

        <div className="bg-white rounded-xl border border-gray-100 p-6">
          <h2 className="text-lg font-semibold text-[#0F172A] mb-5">实体审核进度</h2>
          {totalEntities === 0 ? (
            <p className="text-[#94A3B8] text-sm py-4">暂无数据</p>
          ) : (
            <>
              <StatusBar label="已通过" count={allEntities.filter((e) => e.status === 'APPROVED').length} total={totalEntities} color="bg-green-500" />
              <StatusBar label="待审核" count={allEntities.filter((e) => e.status === 'PENDING').length} total={totalEntities} color="bg-yellow-500" />
              <StatusBar label="已拒绝" count={allEntities.filter((e) => e.status === 'REJECTED').length} total={totalEntities} color="bg-red-500" />
            </>
          )}
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-100 p-6">
        <h2 className="text-lg font-semibold text-[#0F172A] mb-5">置信度分布</h2>
        {characters.length === 0 ? (
          <p className="text-[#94A3B8] text-sm py-4">暂无数据</p>
        ) : (
          <div className="grid grid-cols-5 gap-3">
            {[
              { label: '90-100%', chars: characters.filter((c) => c.confidence >= 0.9) },
              { label: '80-89%', chars: characters.filter((c) => c.confidence >= 0.8 && c.confidence < 0.9) },
              { label: '70-79%', chars: characters.filter((c) => c.confidence >= 0.7 && c.confidence < 0.8) },
              { label: '60-69%', chars: characters.filter((c) => c.confidence >= 0.6 && c.confidence < 0.7) },
              { label: '< 60%', chars: characters.filter((c) => c.confidence < 0.6) },
            ].map((group) => {
              const pct = characters.length > 0 ? (group.chars.length / characters.length) * 100 : 0;
              return (
                <div key={group.label} className="text-center">
                  <div className="relative h-32 bg-[#F1F5F9] rounded-lg overflow-hidden flex items-end">
                    <div
                      className="w-full bg-gradient-to-t from-[#3B82F6] to-[#60A5FA] rounded-lg transition-all duration-500"
                      style={{ height: `${Math.max(pct, 4)}%` }}
                    />
                    <span className="absolute inset-0 flex items-center justify-center text-lg font-bold text-[#0F172A]">
                      {group.chars.length}
                    </span>
                  </div>
                  <p className="text-xs text-[#64748B] mt-2">{group.label}</p>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="bg-white rounded-xl border border-gray-100 p-6">
        <h2 className="text-lg font-semibold text-[#0F172A] mb-5">重要性分层分布（地点 + 物品）</h2>
        {[...locations, ...items].length === 0 ? (
          <p className="text-[#94A3B8] text-sm py-4">暂无地点或物品数据</p>
        ) : (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {[
              { key: 'core' as const, label: '核心', color: 'from-purple-500 to-purple-400', textColor: 'text-purple-700', bgColor: 'bg-purple-50' },
              { key: 'supporting' as const, label: '支撑', color: 'from-blue-500 to-blue-400', textColor: 'text-blue-700', bgColor: 'bg-blue-50' },
              { key: 'candidate' as const, label: '候选', color: 'from-gray-400 to-gray-300', textColor: 'text-gray-600', bgColor: 'bg-gray-50' },
              { key: 'archived' as const, label: '归档', color: 'from-gray-300 to-gray-200', textColor: 'text-gray-400', bgColor: 'bg-gray-50' },
            ].map(({ key, label, color, textColor, bgColor }) => {
              const locCount = locations.filter((l) => l.tier === key).length;
              const itemCount = items.filter((i) => i.tier === key).length;
              const total = locCount + itemCount;
              return (
                <div key={key} className={`${bgColor} rounded-xl p-5`}>
                  <div className="flex items-center gap-2 mb-3">
                    <div className={`w-3 h-3 rounded-full bg-gradient-to-br ${color}`} />
                    <span className={`text-sm font-semibold ${textColor}`}>{label}</span>
                  </div>
                  <p className="text-3xl font-bold text-[#0F172A] mb-1">{total}</p>
                  <p className="text-xs text-[#94A3B8]">
                    {locCount} 地点 · {itemCount} 物品
                  </p>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
