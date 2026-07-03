import { FallbackProps } from 'react-error-boundary';

export function ErrorFallback({ error, resetErrorBoundary }: FallbackProps) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6">
      <div className="max-w-md space-y-4 rounded-lg border bg-card p-6 shadow">
        <h1 className="text-lg font-semibold text-destructive">页面出错了</h1>
        <pre className="max-h-40 overflow-auto rounded bg-muted p-3 text-xs">
          {error.message}
        </pre>
        <button
          onClick={resetErrorBoundary}
          className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground"
        >
          重试
        </button>
      </div>
    </div>
  );
}
