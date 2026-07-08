import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { Download, FileJson, FileText, Loader2, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { fetchExportPreview, getExportUrl, type ExportFormat, type ExportType } from '@/api/export';
import { useExtractionArtifacts } from '@/api/artifacts';
import { downloadBlob, downloadJson, downloadText } from '@/components/story/PromptCopyBlock';
import { getToken } from '@/store/authStore';

const FORMATS: { value: ExportFormat; label: string }[] = [
  { value: 'json', label: 'JSON' },
  { value: 'markdown', label: 'Markdown' },
  { value: 'csv', label: 'CSV' },
];

const TYPES: { value: ExportType; label: string }[] = [
  { value: 'character', label: '角色' },
  { value: 'location', label: '场景' },
  { value: 'item', label: '道具' },
];

export function ExportPage() {
  const { bookId = '' } = useParams();
  const [format, setFormat] = useState<ExportFormat>('json');
  const [type, setType] = useState<ExportType>('character');
  const [preview, setPreview] = useState<string>('');
  const [loading, setLoading] = useState(false);

  const loadPreview = async (fmt: ExportFormat, t: ExportType = type) => {
    setFormat(fmt);
    setLoading(true);
    try {
      const text = await fetchExportPreview(bookId, fmt, t);
      setPreview(text);
    } catch (e) {
      toast.error(`加载预览失败：${(e as Error).message}`);
    } finally {
      setLoading(false);
    }
  };

  // 用 fetch 带 Authorization 头下载（window.location.href 导航无法带 Auth 头，
  // 生产环境无 cookie 会话时会 401）。拿到 Blob 后用 downloadBlob 触发保存。
  const download = async () => {
    try {
      const token = getToken();
      const res = await fetch(getExportUrl(bookId, format, type), {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) {
        throw new Error(`导出失败（HTTP ${res.status}）`);
      }
      const blob = await res.blob();
      // 从 Content-Disposition 取文件名，取不到则按 type.format 兜底
      const dispo = res.headers.get('content-disposition') || '';
      const match = dispo.match(/filename="?([^";]+)"?/i);
      const filename = match?.[1] || `${type}-${bookId}.${format === 'markdown' ? 'md' : format}`;
      downloadBlob(blob, filename);
    } catch (e) {
      toast.error(`导出失败：${(e as Error).message}`);
    }
  };

  const onTypeChange = (v: string) => {
    const next = v as ExportType;
    setType(next);
    setPreview('');
    loadPreview(format, next);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">导出实体</h2>
          <p className="text-xs text-muted-foreground">选择实体类型与格式，预览后下载</p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={type} onValueChange={onTypeChange}>
            <SelectTrigger className="w-28">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TYPES.map((t) => (
                <SelectItem key={t.value} value={t.value}>
                  {t.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button onClick={download} className="gap-2">
            <Download className="h-4 w-4" />
            下载 {format.toUpperCase()}
          </Button>
        </div>
      </div>

      <Tabs value={format} onValueChange={(v) => loadPreview(v as ExportFormat)}>
        <TabsList>
          {FORMATS.map((f) => (
            <TabsTrigger key={f.value} value={f.value}>
              {f.label}
            </TabsTrigger>
          ))}
        </TabsList>
        {FORMATS.map((f) => (
          <TabsContent key={f.value} value={f.value}>
            <Card>
              <CardContent className="p-0">
                {loading ? (
                  <p className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    加载中…
                  </p>
                ) : preview ? (
                  <pre className="max-h-[60vh] overflow-auto p-4 text-xs">{preview}</pre>
                ) : (
                  <p className="p-6 text-sm text-muted-foreground">点击标签页预览</p>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        ))}
      </Tabs>

      <ArtifactsExportCard bookId={bookId} />
    </div>
  );
}

/** 提取富产物导出：全部提示词 Markdown、结构化产物 JSON。无产物时不渲染。 */
function ArtifactsExportCard({ bookId }: { bookId: string }) {
  const artifactsQ = useExtractionArtifacts(bookId);
  const data = artifactsQ.data;
  if (!data?.available) return null;

  const counts = {
    characters: Object.keys(data.characters).length,
    locations: Object.keys(data.locations).length,
    items: Object.keys(data.items).length,
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Sparkles className="h-4 w-4 text-amber-500" />
          提取富产物导出
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          来自运行 {data.runDir} · 角色 {counts.characters} / 场景 {counts.locations} / 道具{' '}
          {counts.items}（含视觉设定与生成提示词）
        </p>
      </CardHeader>
      <CardContent className="flex flex-wrap gap-2">
        {data.allPromptsMd && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => downloadText(data.allPromptsMd!, `${data.runDir}-all-prompts.md`)}
          >
            <FileText className="mr-1.5 h-4 w-4" />
            全部提示词 (Markdown)
          </Button>
        )}
        <Button
          variant="outline"
          size="sm"
          onClick={() =>
            downloadJson(
              {
                runDir: data.runDir,
                generatedAt: data.generatedAt,
                characters: data.characters,
                locations: data.locations,
                items: data.items,
              },
              `${data.runDir}-artifacts.json`,
            )
          }
        >
          <FileJson className="mr-1.5 h-4 w-4" />
          富产物 JSON（三类全量）
        </Button>
      </CardContent>
    </Card>
  );
}
