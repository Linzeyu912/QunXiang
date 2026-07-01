import { useState, useEffect } from 'react';
import { Download, Moon, Sun, FileJson, FileSpreadsheet, FileText, Cpu, Zap, Bot, Eye, EyeOff, Key, Globe, Box, Loader2, CheckCircle2, XCircle, Server } from 'lucide-react';
import { api } from '../api/client';
import { useUIStore } from '../store';

type LlmProviderType = 'ollama' | 'custom' | 'mock';

function downloadFile(content: string, filename: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export default function SettingsPage() {
  const [exporting, setExporting] = useState(false);
  const [darkMode, setDarkMode] = useState(false);

  // LLM config state
  const llmProvider = useUIStore((s) => s.llmProvider);
  const llmConfigured = useUIStore((s) => s.llmConfigured);
  const llmLoaded = useUIStore((s) => s.llmLoaded);
  const keyHint = useUIStore((s) => s.keyHint);
  const llmBaseUrl = useUIStore((s) => s.llmBaseUrl);
  const llmModel = useUIStore((s) => s.llmModel);
  const setLlmConfig = useUIStore((s) => s.setLlmConfig);
  const setLlmStatus = useUIStore((s) => s.setLlmStatus);

  // Form state
  const [selectedProvider, setSelectedProvider] = useState<LlmProviderType>('custom');
  const [apiKey, setApiKey] = useState('');
  const [baseUrl, setBaseUrl] = useState('https://api.openai.com/v1');
  const [model, setModel] = useState('gpt-4o');
  const [showKey, setShowKey] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);

  // Load LLM status on mount
  useEffect(() => {
    if (!llmLoaded) {
      api.getLlmStatus()
        .then((data) => setLlmConfig({
          provider: data.provider,
          configured: data.configured,
          keyHint: data.keyHint,
          baseUrl: data.baseUrl,
          model: data.model,
        }))
        .catch(() => setLlmStatus('none', false));
    }
  }, [llmLoaded, setLlmConfig, setLlmStatus]);

  // Sync form defaults from store
  useEffect(() => {
    if (llmLoaded) {
      // Derive provider type from store
      if (llmProvider === 'mock') {
        setSelectedProvider('mock');
      } else if (llmProvider === 'ollama') {
        setSelectedProvider('ollama');
      } else {
        setSelectedProvider('custom');
      }
      if (llmBaseUrl) setBaseUrl(llmBaseUrl);
      if (llmModel) setModel(llmModel);
    }
  }, [llmLoaded, llmProvider, llmBaseUrl, llmModel]);

  const handleProviderSelect = (type: LlmProviderType) => {
    setSelectedProvider(type);
    setTestResult(null);
    // Reset form fields based on provider type
    if (type === 'ollama') {
      setApiKey('');
      setBaseUrl('http://localhost:11434');
      setModel('llama3.2');
    } else if (type === 'custom') {
      setBaseUrl('https://api.openai.com/v1');
      setModel('gpt-4o');
    }
    // mock needs no config
  };

  const handleSave = async () => {
    setSaving(true);
    setTestResult(null);
    try {
      const config: { provider: LlmProviderType; apiKey?: string; baseUrl?: string; model?: string } = {
        provider: selectedProvider,
      };
      if (selectedProvider === 'custom' && apiKey) {
        config.apiKey = apiKey;
      }
      if (selectedProvider !== 'mock') {
        config.baseUrl = baseUrl;
        config.model = model;
      }

      const data = await api.configureLlm(config);
      setLlmConfig({
        provider: data.provider,
        configured: data.configured,
        keyHint: data.keyHint,
        baseUrl: data.baseUrl,
        model: data.model,
      });
      // Clear the key input after save (it's now stored server-side)
      setApiKey('');
    } catch (err) {
      console.error('Failed to save config:', err);
      alert('保存配置失败，请重试');
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const result = await api.testLlmConnection();
      setTestResult(result);
    } catch (err) {
      setTestResult({
        success: false,
        message: err instanceof Error ? err.message : '测试失败',
      });
    } finally {
      setTesting(false);
    }
  };

  const providerLabel: Record<string, string> = {
    mock: 'Mock 模拟',
    ollama: 'Ollama 本地',
    custom: 'LLM API',
    none: '未配置',
    '': '加载中...',
  };
  const currentLabel = providerLabel[llmProvider] || llmProvider;

  const handleExport = async (format: 'json' | 'csv' | 'markdown') => {
    setExporting(true);
    try {
      const { books } = await api.listBooks();
      const extractedBooks = books.filter((b) => b.status === 'EXTRACTED');
      let characters: { id: string; name: string; aliases: string[]; description?: string; confidence: number; status: string; chapterRef?: string }[] = [];
      if (extractedBooks.length > 0) {
        const results = await Promise.all(
          extractedBooks.map((b) => api.listCharacters(b.id).catch(() => ({ characters: [] })))
        );
        characters = results.flatMap((r) => r.characters);
      }
      if (format === 'json') {
        downloadFile(JSON.stringify(characters, null, 2), 'characters.json', 'application/json');
      } else if (format === 'csv') {
        const headers = ['id', 'name', 'aliases', 'description', 'confidence', 'status', 'chapterRef'];
        const rows = characters.map((c) => [
          c.id,
          c.name,
          c.aliases.join(';'),
          c.description || '',
          c.confidence,
          c.status,
          c.chapterRef || '',
        ]);
        const csv = [headers.join(','), ...rows.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(','))].join('\n');
        downloadFile(csv, 'characters.csv', 'text/csv');
      } else {
        const md = characters.map((c) => {
          const aliases = c.aliases.length > 0 ? `（${c.aliases.join('、')}）` : '';
          const desc = c.description ? `\n${c.description}` : '';
          return `## ${c.name}${aliases}\n- 置信度：${(c.confidence * 100).toFixed(0)}%\n- 状态：${c.status}${desc}\n`;
        }).join('\n---\n\n');
        downloadFile(md, 'characters.md', 'text/markdown');
      }
    } catch (err) {
      console.error('Export failed:', err);
      alert('导出失败');
    } finally {
      setExporting(false);
    }
  };

  // Provider cards config
  const providerCards: { type: LlmProviderType; icon: typeof Cpu; label: string; desc: string }[] = [
    { type: 'ollama', icon: Server, label: 'Ollama', desc: '本地运行，免费' },
    { type: 'custom', icon: Cpu, label: 'Custom API', desc: 'OpenAI 兼容接口' },
    { type: 'mock', icon: Bot, label: 'Mock', desc: '模拟提取（无需API）' },
  ];

  return (
    <div className="space-y-8 max-w-2xl">
      <div>
        <h1 className="text-2xl font-semibold text-[#0F172A] mb-1">设置</h1>
        <p className="text-[#64748B] text-sm">管理导出选项、界面偏好和 LLM 配置</p>
      </div>

      {/* LLM Configuration Card */}
      <div className="bg-white rounded-xl border border-gray-100 p-6">
        <h2 className="text-lg font-semibold text-[#0F172A] mb-2">LLM 配置</h2>
        <p className="text-sm text-[#64748B] mb-5">选择并配置大语言模型提供商，配置即时生效且加密持久化</p>

        {/* Status bar */}
        <div className="flex items-center gap-3 mb-5 px-4 py-3 rounded-lg bg-[#F8FAFC] border border-gray-100">
          <div className={`w-2.5 h-2.5 rounded-full ${llmConfigured ? 'bg-green-500' : 'bg-gray-300'}`} />
          <div className="flex-1">
            <p className="text-sm font-medium text-[#334155]">当前 Provider</p>
            <p className="text-xs text-[#94A3B8]">
              {currentLabel} · {llmConfigured ? '可用' : '不可用'}
              {keyHint && <span className="ml-2 text-[#64748B]">Key: {keyHint}</span>}
            </p>
          </div>
        </div>

        {/* Provider selector */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-5">
          {providerCards.map(({ type, icon: Icon, label, desc }) => (
            <button
              key={type}
              onClick={() => handleProviderSelect(type)}
              className={`flex flex-col items-center gap-2 px-4 py-4 rounded-lg border-2 text-sm font-medium transition-all ${
                selectedProvider === type
                  ? 'border-[#2563EB] bg-[#EFF6FF] text-[#1D4ED8]'
                  : 'border-gray-200 bg-white text-[#64748B] hover:border-gray-300 hover:bg-[#FAFBFC]'
              }`}
            >
              <Icon size={20} />
              <span>{label}</span>
              <span className="text-xs font-normal opacity-70">{desc}</span>
            </button>
          ))}
        </div>

        {/* Configuration form — shown for custom and ollama */}
        {selectedProvider !== 'mock' && (
          <div className="space-y-4 mb-5">
            {/* API Key — only for custom */}
            {selectedProvider === 'custom' && (
              <div>
                <label className="block text-sm font-medium text-[#334155] mb-1.5">
                  <Key size={14} className="inline mr-1.5 -mt-0.5" />
                  API Key
                </label>
                <div className="relative">
                  <input
                    type={showKey ? 'text' : 'password'}
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    placeholder={keyHint ? `当前: ${keyHint}` : '输入 API Key（如 sk-...）'}
                    className="w-full px-3 py-2.5 pr-10 rounded-lg border border-gray-200 text-sm text-[#0F172A] placeholder-[#94A3B8] focus:outline-none focus:ring-2 focus:ring-[#2563EB]/20 focus:border-[#2563EB] transition-colors"
                  />
                  <button
                    type="button"
                    onClick={() => setShowKey(!showKey)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#94A3B8] hover:text-[#64748B] transition-colors"
                  >
                    {showKey ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
                <p className="text-xs text-[#94A3B8] mt-1">API Key 经 AES-256 加密存储，服务重启后自动恢复</p>
              </div>
            )}

            {/* Base URL */}
            <div>
              <label className="block text-sm font-medium text-[#334155] mb-1.5">
                <Globe size={14} className="inline mr-1.5 -mt-0.5" />
                Base URL
              </label>
              <input
                type="text"
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                placeholder={selectedProvider === 'ollama' ? 'http://localhost:11434' : 'https://api.openai.com/v1'}
                className="w-full px-3 py-2.5 rounded-lg border border-gray-200 text-sm text-[#0F172A] placeholder-[#94A3B8] focus:outline-none focus:ring-2 focus:ring-[#2563EB]/20 focus:border-[#2563EB] transition-colors"
              />
            </div>

            {/* Model */}
            <div>
              <label className="block text-sm font-medium text-[#334155] mb-1.5">
                <Box size={14} className="inline mr-1.5 -mt-0.5" />
                模型名称
              </label>
              <input
                type="text"
                value={model}
                onChange={(e) => setModel(e.target.value)}
                placeholder={selectedProvider === 'ollama' ? 'llama3.2' : 'gpt-4o'}
                className="w-full px-3 py-2.5 rounded-lg border border-gray-200 text-sm text-[#0F172A] placeholder-[#94A3B8] focus:outline-none focus:ring-2 focus:ring-[#2563EB]/20 focus:border-[#2563EB] transition-colors"
              />
            </div>
          </div>
        )}

        {/* Action buttons */}
        <div className="flex items-center gap-3">
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-2 px-5 py-2.5 rounded-lg bg-[#2563EB] text-white text-sm font-medium hover:bg-[#1D4ED8] transition-colors disabled:opacity-50"
          >
            {saving ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle2 size={16} />}
            保存配置
          </button>

          {llmConfigured && (
            <button
              onClick={handleTest}
              disabled={testing}
              className="flex items-center gap-2 px-4 py-2.5 rounded-lg border border-gray-200 text-[#334155] text-sm font-medium hover:bg-[#F8FAFC] transition-colors disabled:opacity-50"
            >
              {testing ? <Loader2 size={16} className="animate-spin" /> : <Zap size={16} />}
              测试连接
            </button>
          )}
        </div>

        {/* Test result */}
        {testResult && (
          <div className={`mt-3 flex items-center gap-2 px-3 py-2 rounded-lg text-sm ${
            testResult.success
              ? 'bg-green-50 text-green-700 border border-green-100'
              : 'bg-red-50 text-red-700 border border-red-100'
          }`}>
            {testResult.success ? <CheckCircle2 size={16} /> : <XCircle size={16} />}
            {testResult.message}
          </div>
        )}

        {/* Encryption notice */}
        <p className="text-xs text-[#94A3B8] mt-4">
          API Key 经 AES-256-GCM 加密存储于服务端，重启后自动恢复。前端仅显示掩码。
        </p>
      </div>

      {/* Data Export Card */}
      <div className="bg-white rounded-xl border border-gray-100 p-6">
        <h2 className="text-lg font-semibold text-[#0F172A] mb-4">数据导出</h2>
        <p className="text-sm text-[#64748B] mb-5">将所有角色提取结果导出为指定格式文件</p>
        <div className="flex flex-wrap gap-3">
          <button
            onClick={() => handleExport('json')}
            disabled={exporting}
            className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-[#EFF6FF] text-[#1D4ED8] text-sm font-medium hover:bg-[#DBEAFE] transition-colors disabled:opacity-50"
          >
            <FileJson size={18} />
            导出 JSON
          </button>
          <button
            onClick={() => handleExport('csv')}
            disabled={exporting}
            className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-[#ECFDF5] text-green-700 text-sm font-medium hover:bg-green-100 transition-colors disabled:opacity-50"
          >
            <FileSpreadsheet size={18} />
            导出 CSV
          </button>
          <button
            onClick={() => handleExport('markdown')}
            disabled={exporting}
            className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-[#F5F3FF] text-purple-700 text-sm font-medium hover:bg-purple-100 transition-colors disabled:opacity-50"
          >
            <FileText size={18} />
            导出 Markdown
          </button>
        </div>
      </div>

      {/* Appearance Card */}
      <div className="bg-white rounded-xl border border-gray-100 p-6">
        <h2 className="text-lg font-semibold text-[#0F172A] mb-4">外观</h2>
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-[#334155]">暗黑模式</p>
            <p className="text-xs text-[#94A3B8] mt-0.5">切换深色主题（即将推出）</p>
          </div>
          <button
            onClick={() => setDarkMode(!darkMode)}
            className={`relative w-12 h-7 rounded-full transition-colors duration-200 ${darkMode ? 'bg-[#2563EB]' : 'bg-gray-200'}`}
          >
            <span
              className={`absolute top-0.5 left-0.5 w-6 h-6 bg-white rounded-full shadow-sm flex items-center justify-center transition-transform duration-200 ${darkMode ? 'translate-x-5' : ''}`}
            >
              {darkMode ? <Moon size={14} className="text-[#2563EB]" /> : <Sun size={14} className="text-yellow-500" />}
            </span>
          </button>
        </div>
      </div>

      {/* About Card */}
      <div className="bg-white rounded-xl border border-gray-100 p-6">
        <h2 className="text-lg font-semibold text-[#0F172A] mb-4">关于</h2>
        <div className="space-y-2 text-sm text-[#64748B]">
          <p><span className="text-[#334155] font-medium">项目名称：</span>Novel Agent</p>
          <p><span className="text-[#334155] font-medium">版本：</span>v0.1.0</p>
          <p><span className="text-[#334155] font-medium">描述：</span>小说角色提取多智能体管道</p>
        </div>
      </div>
    </div>
  );
}
