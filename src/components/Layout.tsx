import { Outlet, Link, useLocation } from 'react-router-dom';
import { ShoppingCart, History, Home, Shield, LogOut } from 'lucide-react';
import { cn } from '../lib/utils';
import { useAuth } from '../contexts/AuthContext';

const Layout: React.FC = () => {
    const location = useLocation();
    const { user, logout, isAdmin } = useAuth();

    const isActive = (path: string) => {
        if (path === '/') return location.pathname === '/';
        return location.pathname.startsWith(path);
    };

    const navItemClass = (path: string) => cn(
        "flex items-center gap-2 px-4 py-2 rounded-md transition-colors text-sm",
        isActive(path)
            ? "bg-amazon-blue text-white font-medium shadow-sm"
            : "text-slate-600 hover:bg-slate-200"
    );

    return (
        <div className="min-h-screen flex flex-col bg-slate-50">
            <header className="bg-white border-b border-slate-200 shadow-sm sticky top-0 z-10">
                <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <div className="bg-amazon-orange p-2 rounded-lg">
                            <ShoppingCart className="w-6 h-6 text-white" />
                        </div>
                        <div>
                            <h1 className="text-xl font-bold text-slate-800 leading-none">PriceChecker</h1>
                            <span className="text-xs text-slate-500 font-medium">Keepa + 楽天 Edition</span>
                        </div>
                    </div>

                    <nav className="flex items-center gap-1">
                        <Link to="/" className={navItemClass('/')}>
                            <Home className="w-4 h-4" />
                            ホーム
                        </Link>
                        <Link to="/history" className={navItemClass('/history')}>
                            <History className="w-4 h-4" />
                            履歴
                        </Link>
                        {isAdmin && (
                            <Link to="/admin" className={navItemClass('/admin')}>
                                <Shield className="w-4 h-4" />
                                管理
                            </Link>
                        )}
                        <div className="ml-2 pl-2 border-l border-slate-200 flex items-center gap-2">
                            <span className="text-xs text-slate-500">
                                {user?.username}
                                <span className={`ml-1 px-1.5 py-0.5 rounded text-[10px] font-medium ${
                                    user?.role === 'admin' ? 'bg-indigo-100 text-indigo-700' : 'bg-slate-100 text-slate-600'
                                }`}>
                                    {user?.role === 'admin' ? '管理者' : '会員'}
                                </span>
                            </span>
                            <button onClick={logout} className="flex items-center gap-1 px-2 py-1.5 text-xs text-red-500 hover:text-red-700 hover:bg-red-50 rounded transition-colors" title="ログアウト">
                                <LogOut className="w-3.5 h-3.5" />
                            </button>
                        </div>
                    </nav>
                </div>
            </header>

            <main className="flex-1 w-full max-w-7xl mx-auto px-4 py-8">
                <Outlet />
            </main>

            <footer className="bg-white border-t border-slate-200 py-6">
                <div className="max-w-7xl mx-auto px-4 text-center text-slate-400 text-sm">
                    <p>&copy; {new Date().getFullYear()} Amazon Price Checker</p>
                </div>
            </footer>
        </div>
    );
};

export default Layout;
