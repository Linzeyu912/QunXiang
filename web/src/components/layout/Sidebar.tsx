import { NavLink, useLocation } from 'react-router-dom';
import {
  Upload,
  Library,
  LayoutDashboard,
  Settings,
  BookOpen,
} from 'lucide-react';
import { useAuthStore } from '@/store/authStore';

const navItems = [
  { to: '/', icon: Upload, label: '上传' },
  { to: '/library', icon: Library, label: '书库' },
  { to: '/dashboard', icon: LayoutDashboard, label: '仪表盘' },
  { to: '/settings', icon: Settings, label: '设置' },
];

export default function Sidebar() {
  const location = useLocation();
  const user = useAuthStore((s) => s.user);

  return (
    <aside className="fixed left-0 top-0 h-full w-64 bg-white border-r border-gray-200 flex flex-col z-40">
      <div className="px-6 py-5 border-b border-gray-100">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-[#2563EB] to-[#1D4ED8] flex items-center justify-center shadow-sm">
            <BookOpen className="w-4.5 h-4.5 text-white" size={18} />
          </div>
          <span className="text-lg font-semibold text-[#0F172A] tracking-tight">
            QunXiang
          </span>
        </div>
      </div>

      <nav className="flex-1 px-3 py-4 space-y-1">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive =
            item.to === '/'
              ? location.pathname === '/'
              : location.pathname.startsWith(item.to);
          return (
            <NavLink
              key={item.to}
              to={item.to}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-200 ${
                isActive
                  ? 'bg-[#EFF6FF] text-[#1D4ED8] shadow-sm'
                  : 'text-[#64748B] hover:bg-[#F1F5F9] hover:text-[#334155]'
              }`}
            >
              <Icon size={18} className={isActive ? 'text-[#2563EB]' : ''} />
              {item.label}
            </NavLink>
          );
        })}
      </nav>

      <div className="px-5 py-4 border-t border-gray-100">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-[#3B82F6] to-[#2563EB] flex items-center justify-center text-white text-xs font-semibold">
            {(user?.name ?? '?').slice(0, 1).toUpperCase()}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-[#0F172A] truncate">{user?.name ?? '未登录'}</p>
            <p className="text-xs text-[#94A3B8] truncate">{user?.email ?? ''}</p>
          </div>
        </div>
      </div>
    </aside>
  );
}
