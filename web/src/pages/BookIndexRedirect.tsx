import { Navigate, useParams } from 'react-router-dom';
import { useStages } from '@/api/extraction';
import { useBook } from '@/api/books';

export function BookIndexRedirect() {
  const { bookId = '' } = useParams();
  const stages = useStages(bookId);
  const book = useBook(bookId);

  if (stages.isLoading || book.isLoading) {
    return <p className="text-sm text-muted-foreground">加载中…</p>;
  }

  const target = stages.data?.isComplete ? 'characters' : 'pipeline';
  return <Navigate to={`/books/${bookId}/${target}`} replace />;
}
