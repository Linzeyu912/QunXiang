/** 浏览器端文件下载工具（从 PromptCopyBlock 组件文件迁出，保持组件文件只导出组件）。 */

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** 把任意 JSON 产物下载为文件。 */
export function downloadJson(value: unknown, filename: string) {
  downloadBlob(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }), filename);
}

/** 把纯文本（如 Markdown 提示词集）下载为文件。 */
export function downloadText(text: string, filename: string, mime = 'text/markdown') {
  downloadBlob(new Blob([text], { type: `${mime};charset=utf-8` }), filename);
}
