# AWS SAM 移行 作業一覧

---

## Phase 0: 準備

- [ ] SAM プロジェクトスケルトン作成（`sam init`）
- [ ] `template.yaml` 基本構造作成
  - [ ] Parameters セクション（Env）
  - [ ] Globals セクション（Runtime / Timeout / MemorySize / Architectures / Environment）
- [ ] `.gitignore` 更新（`.aws-sam/` / `node_modules/` / `*.js.map`）
- [ ] ディレクトリ作成
  - [ ] `layers/common/nodejs/`
  - [ ] `functions/auth/`
  - [ ] `functions/entry/`
  - [ ] `functions/pitlog/`
  - [ ] `functions/race/`
  - [ ] `events/`
  - [ ] `tests/`

---

## Phase 1: インフラ基盤

### DynamoDB テーブル定義（template.yaml に追記）

| テーブル | PK | SK | GSI | 主なフィールド |
|---|---|---|---|---|
| UsersTable | `username` | — | — | `password`（bcrypt）, `organizationId` |
| OrganizationsTable | `circuit` | — | — | `name`（組織名） |
| RaceTable | `id` | — | — | `title`, `todayId`（大会ID） |
| EntryTable | `raceId` | `carNum` | — | `className`, `entrantName`, `vehicleName`, `maintenanceArea`, `pitGarage`, `driverA`〜`driverF`, `startDriver` |
| PitLogTable | `raceId` | `id`（ULID） | CarNumIndex（`carNum`） | `manager`, `pitNum`, `inTime`, `outTime`, `garageInTime`, `inDriver`, `outDriver`, `tire`, `oil`, `note` |
| RetireTable | `raceId` | `carNum` | — | `retire`（boolean）, `reason` |

- [ ] 上記 6 テーブルを `template.yaml` に定義
- [ ] 全テーブルの BillingMode を `PAY_PER_REQUEST` に設定
- [ ] `sam build` → `sam deploy` → AWS コンソールでテーブル作成を確認

### Lambda Layer（共通処理）

- [ ] `layers/common/nodejs/package.json`
  - 依存: `@aws-sdk/lib-dynamodb` / `@aws-sdk/client-dynamodb` / `bcryptjs` / `jsonwebtoken`
- [ ] `layers/common/nodejs/dynamodb.js`
  - `DynamoDBDocumentClient` シングルトン生成
  - 環境変数からテーブル名を取得するヘルパー
- [ ] `template.yaml` に `CommonLayer` 追加
- [ ] `npm install`（Layer 依存関係インストール）

---

## Phase 2: 認証・ユーザー管理 API

> 認証不要: `/login`, `/user`　／　認証必要: それ以外

---

### POST `/login` — ログイン
> IF設計書: [login.md](IF/login.md)

- [ ] `functions/auth/login.mjs`
  - バリデーション（username / password）
  - UsersTable から `GetItem`（username で検索）
  - `bcryptjs` でパスワード照合
  - `jsonwebtoken` で JWT 発行（ペイロード: username, organizationId）
- [ ] `template.yaml` に `LoginFunction` 追加（認証不要）
- [ ] `events/login-event.json` 作成

---

### POST `/user` — ユーザー登録
> IF設計書: [regist.md](IF/regist.md)

- [ ] `functions/auth/register.mjs`
  - バリデーション（username / password / circuit）
  - パスワード強度チェック（大文字・小文字・数字を含む 6文字以上）
  - `bcryptjs` でパスワードハッシュ化
  - UsersTable に `PutItem`（ConditionExpression で重複チェック）
- [ ] `template.yaml` に `RegisterFunction` 追加（認証不要）
- [ ] `events/register-event.json` 作成

---

### POST `/user/me` — 大会ID照会
> IF設計書: [conform1.md](IF/conform1.md)

- [ ] `functions/auth/conform.mjs`
  - バリデーション（todayId: 半角英数・15文字以上）
  - RaceTable を `Scan` して `todayId` と照合
- [ ] `template.yaml` に `ConformFunction` 追加（認証必要）
- [ ] `events/conform-event.json` 作成

---

### GET `/user/me` — プロフィール取得
> IF設計書: [conform2.md](IF/conform2.md)

- [ ] `functions/auth/profile.mjs`
  - JWT から `username` を取得
  - UsersTable から `GetItem`
  - OrganizationsTable から `GetItem`（organizationId で検索）
  - `username`, `circuit` を返却
- [ ] `template.yaml` に `ProfileFunction` 追加（認証必要）
- [ ] `events/profile-event.json` 作成

---

### POST `/user/password` — パスワード変更
> IF設計書: [forgetPass.md](IF/forgetPass.md)

- [ ] `functions/auth/changePassword.mjs`
  - バリデーション（username / password / newpassword: 半角英数大文字小文字・6文字以上）
  - UsersTable から `GetItem`
  - `bcryptjs` で現在パスワード照合
  - 新パスワード ≠ 現在パスワード チェック
  - `bcryptjs` で新パスワードハッシュ化 → `UpdateItem`
- [ ] `template.yaml` に `ChangePasswordFunction` 追加（認証必要）
- [ ] `events/change-password-event.json` 作成

---

### インフラ設定（Phase 2 共通）

- [ ] Lambda Authorizer（`functions/auth/authorizer.mjs`）
  - Authorization ヘッダから Bearer トークン抽出
  - `jsonwebtoken` で JWT 検証
  - IAM ポリシードキュメント（Allow / Deny）を返却
- [ ] JWT シークレットを SSM Parameter Store に登録（Lambda 環境変数 `JWT_SECRET` で参照）
- [ ] API Gateway: CORS 設定・Authorizer 設定

### 動作確認（Phase 2）

- [ ] `sam build` && `sam local start-api`
- [ ] ユーザー登録 → ログイン → JWT 取得 の一連フローをテスト
- [ ] 大会ID照会 / プロフィール取得 / パスワード変更が正常動作することを確認
- [ ] JWT なしリクエストが 401 になることを確認

---

## Phase 3: コア API

---

### POST `/entry/bulk` — エントリー一括登録（CSV）
> IF設計書: [about the path of api.md](IF/about%20the%20path%20of%20api.md)

- [ ] `functions/entry/bulkCreate.mjs`
  - CSV 受け取り
  - EntryTable に `BatchWriteItem`
- [ ] `template.yaml` に Function 追加
- [ ] `events/bulk-create-event.json` 作成

---

### POST `/entry/start-driver/bulk` — スタートドライバー一括登録（CSV）
> IF設計書: [about the path of api.md](IF/about%20the%20path%20of%20api.md)

- [ ] `functions/entry/bulkStartDriver.mjs`
  - CSV 受け取り
  - EntryTable に `UpdateItem`（`startDriver` のみ更新）
- [ ] `template.yaml` に Function 追加
- [ ] `events/bulk-start-driver-event.json` 作成

---

### GET `/entries/init` — 初期データ取得
> IF設計書: [autoEnter1.md](IF/autoEnter1.md)　／　autoEnter.html・handEnter.html 共通

- [ ] `functions/entry/init.mjs`
  - EntryTable から車両番号・ドライバー情報を取得
  - `carNum`（配列）と `driver`（車番→ドライバー名配列のオブジェクト）を返却
- [ ] `template.yaml` に Function 追加
- [ ] `events/init-event.json` 作成

---

### POST `/entries/auto` — 自動入力送信
> IF設計書: [autoEnter2.md](IF/autoEnter2.md)

- [ ] `functions/pitlog/autoCreate.mjs`
  - バリデーション（`current` / `unsent`）
  - PitLogTable に `BatchWriteItem`
- [ ] `template.yaml` に Function 追加
- [ ] `events/auto-create-event.json` 作成

---

### POST `/entries/hand` — 手入力送信
> IF設計書: [handEnter2.md](IF/handEnter2.md)

- [ ] `functions/pitlog/handCreate.mjs`
  - バリデーション（carNum / outDriver / inTime / outTime / garageInTime / tire / oil / note）
  - PitLogTable に `PutItem`
- [ ] `template.yaml` に Function 追加
- [ ] `events/hand-create-event.json` 作成

---

### PUT `/pitlog/garage-out` — ガレージアウト更新
> IF設計書: [about the path of api.md](IF/about%20the%20path%20of%20api.md)

- [ ] `functions/pitlog/update.mjs`
  - `outTime = null` のレコードを `CarNumIndex`（GSI）で検索
  - `UpdateItem`（outTime / outDriver を更新）
- [ ] `template.yaml` に Function 追加
- [ ] `events/garage-out-event.json` 作成

---

### GET `/entries/update` — 変更対象ピット記録取得
> IF設計書: [update1.md](IF/update1.md)

- [ ] `functions/pitlog/updateGet.mjs`
  - クエリパラメータ `carNum` で PitLogTable を Query
  - RetireTable を別途取得して Lambda でマージ
  - `garageInTime` が非 null の場合は `pitGap: null`
- [ ] `template.yaml` に Function 追加
- [ ] `events/update-get-event.json` 作成

---

### PUT `/entries/update` — 記録変更 / リタイア登録
> IF設計書: [update2.md](IF/update2.md)

- [ ] `functions/pitlog/updatePut.mjs`
  - selection=1: PitLogTable の指定レコードを `UpdateItem`
  - selection=2: RetireTable に `PutItem`（retire=true / reason）
- [ ] `template.yaml` に Function 追加
- [ ] `events/update-put-event.json` 作成

---

### GET `/entries/show` — 全ピット情報取得
> IF設計書: [showAll.md](IF/showAll.md)　／　showAll.html・output.html 共通

- [ ] `functions/pitlog/showAll.mjs`
  - PitLogTable を全件 Scan
  - RetireTable を全件 Scan
  - Lambda 内で `carNum` をキーにマージ
  - `garageInTime` が非 null の場合は `pitGap: null`
- [ ] `template.yaml` に Function 追加
- [ ] `events/show-all-event.json` 作成

---

### 動作確認（Phase 3）

- [ ] `sam build` && `sam local start-api`
- [ ] エントリー一括登録 → スタートドライバー一括登録 → ピットログ記録 の一連フローをテスト
- [ ] ガレージストップ（POST /entries/auto → PUT /pitlog/garage-out）の 2 回送信フローをテスト
- [ ] 記録変更・リタイア登録が正常動作することを確認
- [ ] GET API でデータが正しく返却されることを確認
- [ ] バリデーションエラー時に 400 が返却されることを確認

---

## IF設計書なし API（管理者用・用途検討中）

> フロント画面に対応するHTMLなし。必要かどうか実装前に確認すること。

| メソッド | パス | 概要 | Lambda ファイル候補 |
|---|---|---|---|
| POST | `/race` | レース登録 | `functions/race/create.mjs` |
| GET | `/race` | レース一覧取得 | `functions/race/list.mjs` |
| POST | `/entry` | エントリー1件登録 | `functions/entry/create.mjs` |
| GET | `/entry` | エントリー一覧取得 | `functions/entry/list.mjs` |
| DELETE | `/entry/{carNum}` | エントリー削除 | `functions/entry/delete.mjs` |
| GET | `/pitlog` | ピットログ一覧取得 | `functions/pitlog/list.mjs` |
