import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';

export function NotFoundPage() {
  return (
    <div className="flex flex-col items-center justify-center gap-4 py-24 text-center">
      <p className="text-4xl font-semibold">404</p>
      <p className="text-sm text-muted-foreground">页面不存在</p>
      <Link to="/library">
        <Button variant="outline">返回书库</Button>
      </Link>
    </div>
  );
}
