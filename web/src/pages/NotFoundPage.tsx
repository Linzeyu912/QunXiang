import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Home, FileQuestion } from 'lucide-react';

export default function NotFoundPage() {
  const navigate = useNavigate();

  return (
    <div className="min-h-[60vh] flex items-center justify-center px-6">
      <div className="text-center">
        {/* 大号 404 数字 + 图标叠加 */}
        <div className="relative inline-block mb-8">
          <span className="text-[120px] font-bold text-[#E2E8F0] leading-none select-none block">
            404
          </span>
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="bg-white rounded-full p-4 shadow-sm border border-[#E2E8F0]">
              <FileQuestion className="w-10 h-10 text-[#64748B]" />
            </div>
          </div>
        </div>

        <h1 className="text-2xl font-semibold text-[#0F172A] mb-3">
          页面不存在
        </h1>
        <p className="text-[#64748B] mb-8 max-w-sm mx-auto leading-relaxed">
          你访问的页面可能已被移除、更名，或暂时不可用
        </p>

        <div className="flex items-center justify-center gap-3">
          <button
            onClick={() => navigate(-1)}
            className="inline-flex items-center gap-2 px-5 py-2.5 bg-white text-[#0F172A] text-sm font-medium rounded-lg border border-[#E2E8F0] hover:bg-[#F8FAFC] transition-colors cursor-pointer"
          >
            <ArrowLeft className="w-4 h-4" />
            返回上页
          </button>
          <a
            href="/"
            className="inline-flex items-center gap-2 px-5 py-2.5 bg-[#0F172A] text-white text-sm font-medium rounded-lg hover:bg-[#1E293B] transition-colors"
          >
            <Home className="w-4 h-4" />
            返回首页
          </a>
        </div>
      </div>
    </div>
  );
}
