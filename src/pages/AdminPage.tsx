import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { UserPlus, Trash2, Key, Shield, Users, Database, Check, X, Loader2 } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';

interface UserInfo {
    id: string;
    username: string;
    role: 'admin' | 'member';
    createdAt: number;
    hasKeepaKey: boolean;
}

interface KeepaKeyState {
    loading: boolean;
    maskedKey: string | null;
    tokensLeft?: number;
    refillRate?: number;
}

const AdminPage: React.FC = () => {
    const { isAdmin } = useAuth();
    const [userList, setUserList] = useState<UserInfo[]>([]);
    const [newUsername, setNewUsername] = useState('');
    const [newPassword, setNewPassword] = useState('');
    const [newRole, setNewRole] = useState<'admin' | 'member'>('member');
    const [message, setMessage] = useState('');
    const [error, setError] = useState('');

    const [changePwUserId, setChangePwUserId] = useState<string | null>(null);
    const [changePwValue, setChangePwValue] = useState('');

    // Keepa APIキー管理
    const [keepaEditUserId, setKeepaEditUserId] = useState<string | null>(null);
    const [keepaKeyInput, setKeepaKeyInput] = useState('');
    const [keepaKeyStates, setKeepaKeyStates] = useState<Record<string, KeepaKeyState>>({});
    const [keepaSaving, setKeepaSaving] = useState(false);

    const fetchUsers = async () => {
        try {
            const res = await axios.get('/api/admin/users');
            setUserList(res.data);
        } catch { setError('ユーザー一覧の取得に失敗しました'); }
    };

    useEffect(() => { fetchUsers(); }, []);

    // Keepaキー情報を取得
    const fetchKeepaKey = async (userId: string) => {
        setKeepaKeyStates(prev => ({ ...prev, [userId]: { loading: true, maskedKey: null } }));
        try {
            const res = await axios.get(`/api/admin/users/${userId}/keepa-key`);
            setKeepaKeyStates(prev => ({
                ...prev,
                [userId]: { loading: false, maskedKey: res.data.maskedKey },
            }));
        } catch {
            setKeepaKeyStates(prev => ({ ...prev, [userId]: { loading: false, maskedKey: null } }));
        }
    };

    // Keepaキー設定
    const handleSetKeepaKey = async (userId: string) => {
        if (!keepaKeyInput || keepaKeyInput.trim().length < 10) {
            setError('有効なKeepa APIキーを入力してください');
            return;
        }
        setKeepaSaving(true);
        setError('');
        try {
            const res = await axios.put(`/api/admin/users/${userId}/keepa-key`, { apiKey: keepaKeyInput.trim() });
            setMessage(`Keepa APIキーを設定しました（残トークン: ${res.data.tokensLeft}, 補充: ${res.data.refillRate}/分）`);
            setKeepaEditUserId(null);
            setKeepaKeyInput('');
            setKeepaKeyStates(prev => ({
                ...prev,
                [userId]: {
                    loading: false,
                    maskedKey: keepaKeyInput.trim().slice(0, 4) + '****' + keepaKeyInput.trim().slice(-4),
                    tokensLeft: res.data.tokensLeft,
                    refillRate: res.data.refillRate,
                },
            }));
            fetchUsers();
        } catch (err: unknown) {
            const e = err as { response?: { data?: { error?: string } } };
            setError(e.response?.data?.error || 'Keepa APIキーの設定に失敗しました');
        } finally {
            setKeepaSaving(false);
        }
    };

    // Keepaキー削除
    const handleDeleteKeepaKey = async (userId: string) => {
        if (!confirm('Keepa APIキーを削除しますか？サーバーキーにフォールバックします。')) return;
        try {
            await axios.delete(`/api/admin/users/${userId}/keepa-key`);
            setMessage('Keepa APIキーを削除しました');
            setKeepaKeyStates(prev => ({ ...prev, [userId]: { loading: false, maskedKey: null } }));
            fetchUsers();
        } catch {
            setError('Keepa APIキーの削除に失敗しました');
        }
    };

    const handleAdd = async (e: React.FormEvent) => {
        e.preventDefault();
        setError(''); setMessage('');
        try {
            await axios.post('/api/admin/users', { username: newUsername, password: newPassword, role: newRole });
            setMessage(`ユーザー「${newUsername}」を作成しました`);
            setNewUsername(''); setNewPassword(''); setNewRole('member');
            fetchUsers();
        } catch (err: unknown) {
            const error = err as { response?: { data?: { error?: string } } };
            setError(error.response?.data?.error || 'ユーザー作成に失敗しました');
        }
    };

    const handleDelete = async (userId: string, username: string) => {
        if (!confirm(`「${username}」を削除しますか？`)) return;
        try {
            await axios.delete(`/api/admin/users/${userId}`);
            setMessage(`「${username}」を削除しました`);
            fetchUsers();
        } catch (err: unknown) {
            const error = err as { response?: { data?: { error?: string } } };
            setError(error.response?.data?.error || '削除に失敗しました');
        }
    };

    const handleChangePassword = async (userId: string) => {
        if (!changePwValue || changePwValue.length < 4) { setError('パスワードは4文字以上必要です'); return; }
        try {
            await axios.patch(`/api/admin/users/${userId}/password`, { password: changePwValue });
            setMessage('パスワードを変更しました');
            setChangePwUserId(null); setChangePwValue('');
        } catch { setError('パスワード変更に失敗しました'); }
    };

    if (!isAdmin) {
        return <div className="p-10 text-center text-red-500">管理者権限が必要です</div>;
    }

    return (
        <div className="max-w-4xl mx-auto space-y-6">
            <div className="flex items-center gap-3">
                <div className="bg-indigo-100 p-2.5 rounded-lg">
                    <Shield className="w-6 h-6 text-indigo-600" />
                </div>
                <div>
                    <h2 className="text-2xl font-bold text-slate-800">ユーザー管理</h2>
                    <p className="text-sm text-slate-500">管理者のみアクセス可能</p>
                </div>
            </div>

            {message && <div className="bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded-lg text-sm">{message}</div>}
            {error && <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">{error}</div>}

            {/* ユーザー追加フォーム */}
            <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
                <h3 className="text-base font-bold text-slate-700 mb-4 flex items-center gap-2">
                    <UserPlus className="w-5 h-5 text-indigo-500" /> 新規ユーザー登録
                </h3>
                <form onSubmit={handleAdd} className="flex flex-wrap gap-3 items-end">
                    <div className="flex-1 min-w-[150px]">
                        <label className="block text-xs font-medium text-slate-600 mb-1">ユーザーID</label>
                        <input type="text" value={newUsername} onChange={e => setNewUsername(e.target.value)}
                            placeholder="ID" className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg outline-none focus:ring-2 focus:ring-indigo-400" required />
                    </div>
                    <div className="flex-1 min-w-[150px]">
                        <label className="block text-xs font-medium text-slate-600 mb-1">パスワード</label>
                        <input type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)}
                            placeholder="4文字以上" className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg outline-none focus:ring-2 focus:ring-indigo-400" required minLength={4} />
                    </div>
                    <div className="w-32">
                        <label className="block text-xs font-medium text-slate-600 mb-1">権限</label>
                        <select value={newRole} onChange={e => setNewRole(e.target.value as 'admin' | 'member')}
                            className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white outline-none focus:ring-2 focus:ring-indigo-400">
                            <option value="member">会員</option>
                            <option value="admin">管理者</option>
                        </select>
                    </div>
                    <button type="submit" className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium rounded-lg transition-colors">
                        登録
                    </button>
                </form>
            </div>

            {/* ユーザー一覧 */}
            <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                <div className="px-6 py-4 border-b border-slate-200 flex items-center gap-2">
                    <Users className="w-5 h-5 text-slate-500" />
                    <h3 className="text-base font-bold text-slate-700">登録ユーザー一覧</h3>
                    <span className="text-xs text-slate-400 ml-2">{userList.length}人</span>
                </div>
                <table className="w-full text-sm text-left">
                    <thead className="bg-slate-50 text-slate-600 border-b border-slate-200">
                        <tr>
                            <th className="px-4 py-3 font-semibold">ユーザーID</th>
                            <th className="px-4 py-3 font-semibold">権限</th>
                            <th className="px-4 py-3 font-semibold">Keepa APIキー</th>
                            <th className="px-4 py-3 font-semibold">作成日</th>
                            <th className="px-4 py-3 font-semibold">操作</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                        {userList.map(u => (
                            <tr key={u.id} className="hover:bg-slate-50">
                                <td className="px-4 py-3 font-medium text-slate-800">{u.username}</td>
                                <td className="px-4 py-3">
                                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                                        u.role === 'admin' ? 'bg-indigo-100 text-indigo-700' : 'bg-slate-100 text-slate-600'
                                    }`}>
                                        {u.role === 'admin' ? '管理者' : '会員'}
                                    </span>
                                </td>
                                <td className="px-4 py-3">
                                    {keepaEditUserId === u.id ? (
                                        <div className="flex gap-1 items-center">
                                            <input
                                                type="text"
                                                value={keepaKeyInput}
                                                onChange={e => setKeepaKeyInput(e.target.value)}
                                                placeholder="Keepa APIキー"
                                                className="px-2 py-1 text-xs border border-slate-300 rounded w-40 outline-none font-mono"
                                            />
                                            <button
                                                onClick={() => handleSetKeepaKey(u.id)}
                                                disabled={keepaSaving}
                                                className="text-xs text-green-600 hover:text-green-800 font-medium flex items-center gap-0.5"
                                            >
                                                {keepaSaving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
                                                保存
                                            </button>
                                            <button
                                                onClick={() => { setKeepaEditUserId(null); setKeepaKeyInput(''); }}
                                                className="text-xs text-slate-400 hover:text-slate-600"
                                            >
                                                <X className="w-3 h-3" />
                                            </button>
                                        </div>
                                    ) : (
                                        <div className="flex items-center gap-2">
                                            {u.hasKeepaKey ? (
                                                <>
                                                    <span className="inline-flex items-center gap-1 text-xs text-green-700 bg-green-50 px-2 py-0.5 rounded-full">
                                                        <Database className="w-3 h-3" /> 設定済み
                                                    </span>
                                                    {keepaKeyStates[u.id]?.maskedKey && (
                                                        <span className="text-xs text-slate-400 font-mono">{keepaKeyStates[u.id].maskedKey}</span>
                                                    )}
                                                    {keepaKeyStates[u.id]?.tokensLeft !== undefined && (
                                                        <span className="text-xs text-blue-600">
                                                            残{keepaKeyStates[u.id].tokensLeft}tok
                                                        </span>
                                                    )}
                                                </>
                                            ) : (
                                                <span className="text-xs text-slate-400">未設定（サーバーキー使用）</span>
                                            )}
                                        </div>
                                    )}
                                </td>
                                <td className="px-4 py-3 text-slate-500 text-xs">{new Date(u.createdAt).toLocaleDateString()}</td>
                                <td className="px-4 py-3">
                                    <div className="flex gap-2 flex-wrap">
                                        {changePwUserId === u.id ? (
                                            <div className="flex gap-1 items-center">
                                                <input type="password" value={changePwValue} onChange={e => setChangePwValue(e.target.value)}
                                                    placeholder="新パスワード" className="px-2 py-1 text-xs border border-slate-300 rounded w-28 outline-none" />
                                                <button onClick={() => handleChangePassword(u.id)} className="text-xs text-green-600 hover:text-green-800 font-medium">保存</button>
                                                <button onClick={() => { setChangePwUserId(null); setChangePwValue(''); }} className="text-xs text-slate-400 hover:text-slate-600">取消</button>
                                            </div>
                                        ) : (
                                            <>
                                                <button onClick={() => setChangePwUserId(u.id)} className="text-xs text-blue-600 hover:text-blue-800 flex items-center gap-1">
                                                    <Key className="w-3 h-3" /> PW
                                                </button>
                                                <button
                                                    onClick={() => {
                                                        setKeepaEditUserId(u.id);
                                                        setKeepaKeyInput('');
                                                        fetchKeepaKey(u.id);
                                                    }}
                                                    className="text-xs text-amber-600 hover:text-amber-800 flex items-center gap-1"
                                                >
                                                    <Database className="w-3 h-3" /> Keepa
                                                </button>
                                                {u.hasKeepaKey && (
                                                    <button
                                                        onClick={() => handleDeleteKeepaKey(u.id)}
                                                        className="text-xs text-orange-500 hover:text-orange-700 flex items-center gap-1"
                                                    >
                                                        <X className="w-3 h-3" /> Keepa削除
                                                    </button>
                                                )}
                                            </>
                                        )}
                                        {u.id !== 'admin' && (
                                            <button onClick={() => handleDelete(u.id, u.username)} className="text-xs text-red-500 hover:text-red-700 flex items-center gap-1">
                                                <Trash2 className="w-3 h-3" /> 削除
                                            </button>
                                        )}
                                    </div>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
};

export default AdminPage;
