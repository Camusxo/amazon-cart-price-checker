import { Outlet, Link, useLocation } from 'react-router-dom';
import { ShoppingCart, History, UploadCloud } from 'lucide-react';
import { cn } from '../lib/utils';

const Layout: React.FC = () => {
    const location = useLocation();

    const navItemClass = (path: string) => cn(
        "flex items-center gap-2 px-4 py-2 rounded-md transition-colors",
        location.pathname === path
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
                            <span className="text-xs text-slate-500 font-medium">Keepa API Edition</span>
                        </div>
                    </div>

                    <nav className="flex items-center gap-2">
                        <Link to="/" className={navItemClass('/')}>
                            <UploadCloud className="w-4 h-4" />
                            Import
                        </Link>
                        <Link to="/history" className={navItemClass('/history')}>
                            <History className="w-4 h-4" />
                            History
                        </Link>
                    </nav>
                </div>
            </header>

            <main className="flex-1 w-full max-w-7xl mx-auto px-4 py-8">
                <Outlet />
            </main>

            <footer className="bg-white border-t border-slate-200 py-6">
                <div className="max-w-7xl mx-auto px-4 text-center text-slate-400 text-sm">
                    <p>&copy; {new Date().getFullYear()} Amazon Price Checker. Not affiliated with Amazon.com, Inc.</p>
                </div>
            </footer>
        </div>
    );
};

export default Layout;
