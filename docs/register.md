# CLIで曲を登録・更新する

Node.js 18以上が必要です。追加依存はありません。Guitar Proファイルは手元に置き、リポジトリにはコミットしないでください。

## Accessの設定（管理者が実施）

1. Cloudflare Zero TrustでAccess service tokenを作成し、Client IDとClient Secretを安全に保存します。
2. このアプリのAccess applicationに、当該service tokenを許可する **Service Auth** policyを追加します。既存の人間用ポリシーも維持します。
3. Workerの既存の `ACCESS_TEAM_DOMAIN` と `ACCESS_AUD` がAccess applicationに一致することを確認します。
4. 管理者が `wrangler secret put ACCESS_SERVICE_TOKENS` を実行し、値に `clientId=sijingsora@gmail.com` を入力します。`clientId` は実際のClient IDに置き換えます。複数なら `clientId=owner@email,clientId2=owner2@email` です。秘密値を設定ファイルやGitに保存しないでください。

Accessが検証したJWTの `common_name` をこの対応表で所有者メールへ変換します。メールは小文字に正規化され、その所有者のR2名前空間 `u/<sha256(identity)>/` にアクセスします。未登録のservice tokenは401になります。Client ID/Secretだけを直接Workerへ送っても認証できません。Accessを通るURLを使ってください。

## 実行

```bash
export CF_ACCESS_CLIENT_ID='your-client-id'
export CF_ACCESS_CLIENT_SECRET='your-client-secret'
export BASS_PRACTICE_API_BASE='https://your-app.example.com'
node scripts/register-song.mjs --gp /path/to/song.gp5 --title 'Example Song' \
  --artist 'Example Artist' --id example-song \
  --original-url 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' \
  --performance-url 'https://youtu.be/dQw4w9WgXcQ' --dry-run
```

`--dry-run` を外すと送信します。dry-runではネットワーク通信をせず、メソッド・URL・ID・曲名・フィールド名・GPバイト数を表示します。秘密値やGP本体は表示しません。

環境変数は `--env-file /path/to/private.env` でも指定できます（`KEY=VALUE` 形式）。ファイルをGit管理しないでください。曲名の既定値はファイル名です。`--id` を省略すると曲名から決定的なIDを生成します。同じ曲を改題するときは元の `--id` を指定してください。IDは `^[A-Za-z0-9_\-.]{1,128}$` です（URLのパスとして解釈される `.` と `..` は使用できません）。URL引数にはYouTube動画URLを指定します。省略したアーティストやURLは既存値を維持します。

## 保存形式と同期

曲は `GET /api/songs/:id` で取得してから `PUT /api/songs/:id` でJSON全体を送ります。新規登録時の404は正常です。曲のフィールドは `id`, `title`, 任意の `artist`, `texData: ""`, `gpData`（ファイル本体の生base64、data URL接頭辞なし）, `gpFormat`（gp/gp3/gp4/gp5/gpx）, `createdAt`, `updatedAt` です。更新時は既存の未知のフィールド、フォルダ、タグも維持します。GPデータ・曲名と指定された値だけを置換し、`updatedAt` は現在時刻と既存値より大きくします。

動画は既存の別API `GET/PUT /api/settings` の `version: 1` ドキュメントで管理されます。`entries[id]` は `{ updatedAt, settings }`、演奏動画は `settings.playthroughUrl`、原曲は `settings.originalUrl` です。CLIは指定されたURLだけを変更し、offset・音量・再生速度や他の曲の設定を維持します。初期設定は `playthroughOffsetSec: 0`, `originalOffsetSec: 0`, `playbackRate: 1` です。練習進捗APIは変更しません。

ブラウザは `/api/songs` の要約の `updatedAt` をローカルと比較し、新しい曲をGETして保存します。所有者としてブラウザにログインし、同期すると一覧に現れます。動画設定も既存の設定同期で反映されます。PUTの409時には再取得して一度だけ再試行します。曲と動画設定は別リクエストなので、途中で失敗した場合は同じIDで再実行してください。

## curlでGETしてからPUT

以下は既存の曲を更新する例です。`jq` とbase64コマンドを使います。認証ヘッダーは両方必要です。

```bash
SONG_ID=example-song
curl --fail-with-body -sS \
  -H "CF-Access-Client-Id: $CF_ACCESS_CLIENT_ID" \
  -H "CF-Access-Client-Secret: $CF_ACCESS_CLIENT_SECRET" \
  "$BASS_PRACTICE_API_BASE/api/songs/$SONG_ID" > /tmp/song-existing.json

base64 < /path/to/song.gp5 | tr -d '\n' > /tmp/song-base64.txt
jq --rawfile gp /tmp/song-base64.txt \
  '. + {title: "Example Song", gpData: $gp, gpFormat: "gp5", updatedAt: ([((now * 1000) | floor), (.updatedAt + 1)] | max)}' \
  /tmp/song-existing.json > /tmp/song-updated.json

curl --fail-with-body -sS -X PUT \
  -H "CF-Access-Client-Id: $CF_ACCESS_CLIENT_ID" \
  -H "CF-Access-Client-Secret: $CF_ACCESS_CLIENT_SECRET" \
  -H 'Content-Type: application/json' \
  --data-binary @/tmp/song-updated.json \
  "$BASS_PRACTICE_API_BASE/api/songs/$SONG_ID"
```

新規の場合は404を確認後、上記の新規フィールドを含むJSONを作成してください。PUT成功時は `{ok:true,song:{id,updatedAt,...要約}}`、同一時刻の場合は既存曲JSON、競合時は409（`{error:"conflict",current:...}` または `{error:"busy"}`）です。最大曲JSONサイズは20 MiBです。動画の更新は同様に `/api/settings` をGETし、対象entryだけ変更してPUTします（サーバーが他のentryとマージします）。
