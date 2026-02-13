import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import Layout from './components/Layout';
import ImportPage from './pages/ImportPage';
import RunPage from './pages/RunPage';
import HistoryPage from './pages/HistoryPage';
import ComparePage from './pages/ComparePage';
import LoginPage from './pages/LoginPage';
import AdminPage from './pages/AdminPage';

function ProtectedRoute({ children }: { children: React.ReactNode }) {
    const { user, isLoading } = useAuth();
    if (isLoading) {
        return (
            <div className="min-h-screen flex items-center justify-center">
                <div className="animate-spin h-8 w-8 border-4 border-indigo-500 rounded-full border-t-transparent" />
            </div>
        );
    }
    if (!user) return <Navigate to="/login" replace />;
    return <>{children}</>;
}

function AdminRoute({ children }: { children: React.ReactNode }) {
    const { user, isAdmin, isLoading } = useAuth();
    if (isLoading) {
        return (
            <div className="min-h-screen flex items-center justify-center">
                <div className="animate-spin h-8 w-8 border-4 border-indigo-500 rounded-full border-t-transparent" />
            </div>
        );
    }
    if (!user) return <Navigate to="/login" replace />;
    if (!isAdmin) return <Navigate to="/" replace />;
    return <>{children}</>;
}

function AppRoutes() {
    const { user } = useAuth();
    return (
        <Routes>
            <Route path="/login" element={user ? <Navigate to="/" replace /> : <LoginPage />} />
            <Route path="/" element={<ProtectedRoute><Layout /></ProtectedRoute>}>
                <Route index element={<ImportPage />} />
                <Route path="results/:runId" element={<RunPage />} />
                <Route path="compare/:compareId" element={<ComparePage />} />
                <Route path="history" element={<HistoryPage />} />
                <Route path="admin" element={<AdminRoute><AdminPage /></AdminRoute>} />
                <Route path="*" element={<Navigate to="/" replace />} />
            </Route>
        </Routes>
    );
}

function App() {
    return (
        <HashRouter>
            <AuthProvider>
                <AppRoutes />
            </AuthProvider>
        </HashRouter>
    );
}

export default App;
