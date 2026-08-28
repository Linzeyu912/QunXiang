/** 状态卡里的键值行：小字标签 + 等宽值，用于服务商/模型/密钥提示等只读信息。 */
export function StatusRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-0.5 break-all font-mono text-xs">{children}</p>
    </div>
  );
}
