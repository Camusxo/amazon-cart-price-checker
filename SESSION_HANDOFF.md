# Session Handoff - Amazon Price Checker

## 最終更新: 2026-02-07

## 現在の状態

### デプロイ済み機能
- Keepa API による Amazon 価格チェック
- 楽天市場との価格比較（PoiPoiスタイルUI）
- JAN コード取得（eanList + upcList）
- 月間販売数（monthlySold）
- メモ機能
- 複数楽天候補表示（最大3件）
- 停止/再開ボタン
- お気に入り（星マーク）+ フィルター
- 縦線区切りで視認性向上
- JWT認証（管理者/会員ロール）
- 3タブインポート（CSV/テキスト/Keepa検索）
- 高度なフィルターパネル（3カラム、カスタムフィルター3スロット保存）
- Keepaグラフ拡大表示（1.6倍）

### 未実装タスク（次回実装）
**楽天比較をデフォルトフローに入れ替え:**
- ImportPage.tsx: 「価格チェック開始」ボタンを2つに分割
  - メインボタン: 「楽天比較開始」（デフォルト）→ autoCompare=true でRunPageへ
  - サブボタン: 「カート価格のみ（高速）」→ 従来通りRunPageへ
- RunPage.tsx: URLパラメータ `autoCompare=true` がある場合、Keepa処理完了後に自動的に `/api/compare-now` を呼び出し ComparePage へ遷移
- RunPage と ComparePage 間の切り替えボタン追加

### 主要ファイル
| ファイル | 説明 |
|----------|------|
| `server.ts` | バックエンド全体（Keepa/楽天/比較/認証） |
| `src/types.ts` | 型定義 |
| `src/pages/ImportPage.tsx` | 3タブインポートページ |
| `src/pages/RunPage.tsx` | Keepa結果表示ページ |
| `src/pages/ComparePage.tsx` | 楽天比較ページ（PoiPoiスタイル） |
| `src/pages/LoginPage.tsx` | ログインページ |
| `src/pages/AdminPage.tsx` | ユーザー管理ページ |
| `src/contexts/AuthContext.tsx` | JWT認証コンテキスト |
| `src/App.tsx` | ルーティング |
| `src/components/Layout.tsx` | ナビゲーション |

### Render環境変数（要設定）
- `JWT_SECRET` - JWT署名キー（必須）
- `ADMIN_PASSWORD` - 管理者パスワード（デフォルト: admin123）
- `KEEPA_API_KEY` - Keepa APIキー
- `RAKUTEN_APP_ID` - 楽天APIアプリケーションID

### デプロイ情報
- URL: https://amazon-price-checker-xohy.onrender.com/
- GitHub: https://github.com/Camusxo/amazon-cart-price-checker
- Render: 自動デプロイ（GitHub push時）
- ログイン: admin / admin123（デフォルト）

### 技術スタック
- Frontend: React + TypeScript + Vite + TailwindCSS
- Backend: Express + TypeScript
- 認証: JWT + bcryptjs
- API: Keepa API, 楽天商品検索API
- デプロイ: Render.com
