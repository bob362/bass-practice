# Cloudflare で自分専用に公開する手順

静的サイト（`npm run build` → `dist/`）を Cloudflare Workers の Static Assets で配信し、
Cloudflare Access（メールのワンタイム PIN）で自分だけが開けるようにします。
※ Cloudflare Pages も使えますが、Cloudflare は今後の新機能を Workers に集中させると発表しているため Workers を推奨。

## 費用
- Workers Static Assets：静的ファイル配信は無料。
- Zero Trust Free プラン：50 ユーザーまで $0。ただし有効化時に支払い方法（カード等）の登録が必要。

## 1. 自分でやること
1. https://dash.cloudflare.com/sign-up でアカウント作成。
2. Workers & Pages → Create → 「Import a repository」→ GitHub 連携で `bob362/bass-practice` を選択。
   - Build command: `npm run build` / Deploy command: `npx wrangler deploy`（`wrangler.jsonc` を自動で使用）
   - 本番ブランチ: `main`（PR マージ後）
3. Zero Trust を開き、チーム名を決めて Free プランを選択（支払い方法の登録あり）。
4. Workers & Pages → `bass-practice` → Settings → Domains & Routes で
   「Cloudflare Access」を有効化し、**本番＋プレビューの両方**を保護。
5. Zero Trust → Access → Applications で該当アプリのポリシーを
   Action: Allow / Include: Emails = `sijingsora@gmail.com` に設定。
   ログイン方法は One-time PIN（既定で有効）。

## 2. 確認
- `https://bass-practice.<サブドメイン>.workers.dev` を開く → メールに届く PIN でログインできること。
- シークレットウィンドウで別メールを入れて弾かれること。
- マイク（オーディオインターフェース）入力は HTTPS が必須。workers.dev は HTTPS なのでそのまま使えます。

## メモ
- pdf.js の worker、alphaTab のフォント／サウンドフォントは jsDelivr CDN から読み込むため、`dist/` には含まれません。
- 練習記録はブラウザの localStorage に保存され、サーバーには送られません。
- 手元から直接デプロイする場合は Node.js 22 以上で `npm run build && npx wrangler deploy`。
