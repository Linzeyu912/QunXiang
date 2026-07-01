import { useState, useRef, useCallback, useEffect } from 'react';
import { Upload, FileText, AlertCircle, CheckCircle, Loader2, Cpu, Bot } from 'lucide-react';
import { api } from '../api/client';
import { useBookStore, useUIStore } from '../store';
import { translateUploadError, translateExtractError } from '../utils/errorTranslator';
import { useExtractionProgress } from '../hooks/useExtractionProgress';
import ExtractionProgress from '../components/extraction/ExtractionProgress';

const MAX_FILE_SIZE = 50 * 1024 * 1024;

function statusBadge(status: string) {
  const map: Record<string, { text: string; cls: string }> = {
    UPLOADED: { text: '待提取', cls: 'bg-blue-100 text-blue-700' },
    EXTRACTING: { text: '提取中', cls: 'bg-yellow-100 text-yellow-700' },
    EXTRACTED: { text: '已提取', cls: 'bg-green-100 text-green-700' },
    FAILED: { text: '提取失败', cls: 'bg-red-100 text-red-700' },
  };
  return map[status] || { text: status, cls: 'bg-gray-100 text-gray-700' };
}

export default function UploadPage() {
  const books = useBookStore((s) => s.books);
  const setBooks = useBookStore((s) => s.setBooks);
  const llmProvider = useUIStore((s) => s.llmProvider);
  const llmLoaded = useUIStore((s) => s.llmLoaded);
  const setLlmStatus = useUIStore((s) => s.setLlmStatus);
  const [uploading, setUploading] = useState(false);
  const [extractingId, setExtractingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const { progress, startPolling, stopPolling } = useExtractionProgress(extractingId);

  // Load LLM status on mount
  useEffect(() => {
    if (!llmLoaded) {
      api.getLlmStatus()
        .then((data) => setLlmStatus(data.provider, data.configured))
        .catch(() => setLlmStatus('none', false));
    }
  }, [llmLoaded, setLlmStatus]);

  const loadBooks = useCallback(async () => {
    try {
      const { books } = await api.listBooks();
      setBooks(books);
    } catch (err) {
      console.error('Failed to load books:', err);
    }
  }, [setBooks]);

  useEffect(() => {
    loadBooks();
  }, [loadBooks]);

  const showError = (msg: string) => {
    setError(msg);
    setTimeout(() => setError(null), 5000);
  };

  const handleUpload = async (file: File) => {
    if (file.size > MAX_FILE_SIZE) {
      showError('文件超过 50MB 限制');
      return;
    }

    setUploading(true);
    try {
      const { book } = await api.uploadBook(file);
      useBookStore.getState().addBook(book);
    } catch (err: any) {
      console.error('Upload failed:', err);
      showError(translateUploadError(err));
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handleUpload(file);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleUpload(file);
  };

  const handleExtract = async (bookId: string) => {
    if (extractingId === bookId) return;
    setExtractingId(bookId);
    startPolling();
    try {
      await api.startExtraction(bookId);
    } catch (err) {
      console.error('Extraction failed:', err);
      showError(translateExtractError(err));
      setExtractingId(null);
      stopPolling();
    }
  };

  // Stop polling and refresh when extraction completes or fails
  useEffect(() => {
    if (progress?.isComplete || progress?.isFailed) {
      setExtractingId(null);
      loadBooks();
    }
  }, [progress?.isComplete, progress?.isFailed, loadBooks]);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold text-[#0F172A] mb-1">上传小说</h1>
        <p className="text-[#64748B] text-sm">
          上传 TXT 文件，系统将自动解析并提取角色信息
          {llmLoaded && (
            <span className={`inline-flex items-center gap-1 ml-2 px-2 py-0.5 rounded text-xs font-medium ${
              llmProvider === 'mock' ? 'bg-yellow-100 text-yellow-700' : 'bg-blue-100 text-blue-700'
            }`}>
              {llmProvider === 'mock' ? <Bot size={12} /> : <Cpu size={12} />}
              {llmProvider === 'mock' ? 'Mock 模式' : llmProvider === 'ollama' ? 'Ollama' : llmProvider === 'custom' ? 'LLM API' : llmProvider}
            </span>
          )}
        </p>
      </div>

      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        onClick={() => inputRef.current?.click()}
        className={`relative border-2 border-dashed rounded-xl p-12 text-center cursor-pointer transition-all duration-300 ${
          dragOver
            ? 'border-[#2563EB] bg-[#EFF6FF] scale-[1.01]'
            : 'border-gray-300 bg-white hover:border-[#3B82F6] hover:bg-[#FAFBFC]'
        }`}
      >
        <input
          ref={inputRef}
          type="file"
          accept=".txt"
          onChange={handleFileChange}
          className="hidden"
        />
        <div className={`mx-auto w-14 h-14 rounded-full flex items-center justify-center mb-4 transition-colors ${
          dragOver ? 'bg-[#2563EB]' : 'bg-[#F1F5F9]'
        }`}>
          {uploading ? (
            <Loader2 className="w-6 h-6 text-[#2563EB] animate-spin" />
          ) : (
            <Upload className={`w-6 h-6 ${dragOver ? 'text-white' : 'text-[#64748B]'}`} />
          )}
        </div>
        <p className="text-sm font-medium text-[#334155] mb-1">
          {uploading ? '上传中...' : '点击或拖拽文件到此处上传'}
        </p>
        <p className="text-xs text-[#94A3B8]">支持 .txt 格式，最大 50MB</p>
      </div>

      {error && (
        <div className="flex items-center gap-2 px-4 py-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
          <AlertCircle size={16} />
          {error}
        </div>
      )}

      {/* Extraction Progress */}
      {progress && extractingId && (
        <ExtractionProgress
          bookId={progress.bookId}
          overallProgress={progress.overallProgress}
          isRunning={progress.isRunning}
          isComplete={progress.isComplete}
          isFailed={progress.isFailed}
          stages={progress.stages}
        />
      )}

      <div>
        <h2 className="text-lg font-semibold text-[#0F172A] mb-4">最近上传</h2>
        {books.length === 0 ? (
          <div className="text-center py-12 bg-white rounded-xl border border-gray-100">
            <FileText className="w-10 h-10 text-gray-300 mx-auto mb-3" />
            <p className="text-[#94A3B8] text-sm">暂无已上传的书籍</p>
          </div>
        ) : (
          <div className="grid gap-3">
            {books.map((book) => {
              const badge = statusBadge(book.status);
              return (
                <div
                  key={book.id}
                  className="bg-white rounded-xl border border-gray-100 p-5 flex items-center justify-between hover:shadow-md transition-shadow duration-200"
                >
                  <div className="flex items-center gap-4">
                    <div className="w-10 h-10 rounded-lg bg-[#F1F5F9] flex items-center justify-center">
                      <FileText className="w-5 h-5 text-[#94A3B8]" />
                    </div>
                    <div>
                      <h3 className="font-medium text-[#0F172A]">{book.title}</h3>
                      <p className="text-xs text-[#94A3B8] mt-0.5">
                        <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium mr-2 ${badge.cls}`}>
                          {badge.text}
                        </span>
                        {new Date(book.createdAt).toLocaleDateString()}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {(book.status === 'UPLOADED' || book.status === 'FAILED') && (
                      <button
                        onClick={(e) => { e.stopPropagation(); handleExtract(book.id); }}
                        disabled={extractingId === book.id}
                        className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                          extractingId === book.id
                            ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                            : 'bg-[#EFF6FF] text-[#1D4ED8] hover:bg-[#DBEAFE]'
                        }`}
                      >
                        {extractingId === book.id ? (
                          <span className="flex items-center gap-1.5">
                            <Loader2 size={14} className="animate-spin" />
                            提取中
                          </span>
                        ) : book.status === 'FAILED' ? (
                          '重试'
                        ) : (
                          '提取'
                        )}
                      </button>
                    )}
                    {book.status === 'EXTRACTED' && (
                      <div className="flex items-center gap-1 text-green-600 text-sm">
                        <CheckCircle size={16} />
                        <span>已完成</span>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
