import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import axios from 'axios';

interface AuthUser {
    id: string;
    username: string;
    role: 'admin' | 'member';
}

interface AuthContextType {
    user: AuthUser | null;
    token: string | null;
    isLoading: boolean;
    login: (username: string, password: string) => Promise<void>;
    logout: () => void;
    isAdmin: boolean;
}

const AuthContext = createContext<AuthContextType | null>(null);

export const useAuth = () => {
    const ctx = useContext(AuthContext);
    if (!ctx) throw new Error('useAuth must be used within AuthProvider');
    return ctx;
};

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [user, setUser] = useState<AuthUser | null>(null);
    const [token, setToken] = useState<string | null>(() => localStorage.getItem('auth_token'));
    const [isLoading, setIsLoading] = useState(true);

    // axiosにtokenを自動付与
    useEffect(() => {
        if (token) {
            axios.defaults.headers.common['Authorization'] = `Bearer ${token}`;
            localStorage.setItem('auth_token', token);
        } else {
            delete axios.defaults.headers.common['Authorization'];
            localStorage.removeItem('auth_token');
        }
    }, [token]);

    // 初回ロード時にトークン検証
    useEffect(() => {
        const verify = async () => {
            if (!token) { setIsLoading(false); return; }
            try {
                const res = await axios.get('/api/auth/me');
                setUser(res.data);
            } catch {
                setToken(null);
                setUser(null);
            }
            setIsLoading(false);
        };
        verify();
    }, []);

    const login = useCallback(async (username: string, password: string) => {
        const res = await axios.post('/api/auth/login', { username, password });
        setToken(res.data.token);
        setUser(res.data.user);
        axios.defaults.headers.common['Authorization'] = `Bearer ${res.data.token}`;
    }, []);

    const logout = useCallback(() => {
        setToken(null);
        setUser(null);
    }, []);

    return (
        <AuthContext.Provider value={{ user, token, isLoading, login, logout, isAdmin: user?.role === 'admin' }}>
            {children}
        </AuthContext.Provider>
    );
};
