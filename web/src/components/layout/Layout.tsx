import { Outlet, useLocation } from 'react-router-dom';
import { ErrorBoundary } from 'react-error-boundary';
import ErrorFallback from '../ErrorFallback';
import Sidebar from './Sidebar';

export default function Layout() {
  const location = useLocation();

  return (
    <div className="min-h-screen bg-[#F8FAFC]">
      <Sidebar />
      <main className="ml-64 min-h-screen">
        <div className="max-w-6xl mx-auto px-6 py-8">
          <ErrorBoundary
            FallbackComponent={ErrorFallback}
            resetKeys={[location.pathname]}
          >
            <Outlet />
          </ErrorBoundary>
        </div>
      </main>
    </div>
  );
}
