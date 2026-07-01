import { FallbackProps } from 'react-error-boundary';
import { AlertTriangle, RefreshCw, Home } from 'lucide-react';

export default function ErrorFallback({
  error,
  resetErrorBoundary,
}: FallbackProps) {
  return (
    <div className="min-h-[400px] flex items-center justify-center p-8">
      <div className="max-w-md w-full text-center">
        <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-red-50 mb-6">
          <AlertTriangle className="w-8 h-8 text-red-500" />
        </div>

        <h2 className="text-xl font-semibold text-[#0F172A] mb-2">
          出了点问题
        </h2>
        <p className="text-sm text-[#64748B] mb-4 leading-relaxed">
          页面渲染时发生了意外错误，你可以尝试以下操作：
        </p>

        {error.message && (
          <pre className="text-xs text-left bg-[#F1F5F9] border border-[#E2E8F0] rounded-lg px-4 py-3 mb-6 overflow-auto max-h-32 text-red-600 font-mono">
            {error.message}
          </pre>
        )}

        <div className="flex items-center justify-center gap-3">
          <button
            onClick={resetErrorBoundary}
            className="inline-flex items-center gap-2 px-5 py-2.5 bg-[#0F172A] text-white text-sm font-medium rounded-lg hover:bg-[#1E293B] transition-colors cursor-pointer"
          >
            <RefreshCw className="w-4 h-4" />
            重试
          </button>
          <a
            href="/"
            className="inline-flex items-center gap-2 px-5 py-2.5 bg-white text-[#0F172A] text-sm font-medium rounded-lg border border-[#E2E8F0] hover:bg-[#F8FAFC] transition-colors"
          >
            <Home className="w-4 h-4" />
            返回首页
          </a>
        </div>

        <p className="mt-4 text-xs text-[#94A3B8]">
          如果问题持续存在，请联系技术支持
        </p>
      </div>
    </div>
  );
}
