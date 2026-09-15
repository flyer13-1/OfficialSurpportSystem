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

| テーブル           | PK           | SK                          | GSI                                             | 主なフィールド                                                                                                                  |
| ------------------ | ------------ | --------------------------- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| UsersTable         | `username`   | —                           | —                                               | `password_hash`（bcrypt）, `organization_id`, `created_at`, `updated_at`                                                        |
| OrganizationsTable | `circuit`    | —                           | —                                               | `name`（組織名）                                                                                                                |
| RaceTable          | `id`         | —                           | —                                               | `title`, `today_id`（大会ID）                                                                                                   |
| EntryTable         | `race_id`    | `car_num`                   | —                                               | `class_name`, `entrant_name`, `vehicle_name`, `maintenance_area`, `pit_garage`, `driver_a`〜`driver_f`                          |
| StartDriverTable   | `race_id`    | `car_num`                   | —                                               | `driver`                                                                                                                        |
| PitAssignmentTable | `race_id`    | `username#maintenance_area` | UsernameIndex（`username`）                     | `maintenance_area`                                                                                                              |
| PitLogTable        | `race_id`    | `id`（ULID）                | CarNumIndex（`car_num`）                        | `username`, `pit_num`, `in_time`, `out_time`, `garage_in_time`, `driver_out`, `tire`, `oil`, `note`, `created_at`, `updated_at` |
| PitLogHistoryTable | `pit_log_id` | `id`（ULID）                | ModifiedByIndex（`modified_by`, `modified_at`） | `action_type`, `modified_by`, `modified_at`, `field_name`, `old_value`, `new_value`                                             |
| RetireTable        | `race_id`    | `car_num`                   | —                                               | `is_retired`（boolean）, `reason`                                                                                               |
| OutpostLogTable    | `race_id`    | `id`（ULID）                | UsernameIndex（`username`）                     | `username`, `created_at`                                                                                                        |

- [ ] 上記 10 テーブルを `template.yaml` に定義
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

> 認証不要: `/user`　／　認証必要: それ以外
>
> **2026-09 Cognito移行**: ログイン認証は Cognito User Pool に一本化。
> `POST /login`・`POST /user/password` の自前実装は廃止した（下記参照）。

---

### （廃止）POST `/login` — ログイン

> IF設計書: [index.md](IF/index.md)

フロントが Cognito に直接 `authenticateUser()` するため、このAPI・
`functions/auth/login.mjs`・`LoginFunction` は削除済み。

---

### POST `/user` — ユーザー登録

> IF設計書: [regist.md](IF/regist.md)

- [x] `functions/auth/register.mjs`
  - バリデーション（username / sub / circuit）※password は扱わない（Cognito管理）
  - UsersTable に `PutItem`（`sub` / `admin: false` / ConditionExpression で重複チェック）
- [x] `template.yaml` に `RegisterFunction`（認証不要）
- [ ] `events/register-event.json` 作成

---

### POST `/user/me` — 大会ID照会

> IF設計書: [userMenu1.md](IF/userMenu1.md)

- [ ] `functions/auth/conform.mjs`
  - バリデーション（`todayId`: 半角英数・15文字以上）
  - RaceTable を `Scan` して `todayId` と照合
- [ ] `template.yaml` に `ConformFunction` 追加（認証必要）
- [ ] `events/conform-event.json` 作成

---

### GET `/user/me` — プロフィール取得

> IF設計書: [userMenu2.md](IF/userMenu2.md)

- [x] `functions/auth/profile.mjs`
  - `requestContext.authorizer.username`（Cognito検証済み）を取得
  - UsersTable から `GetItem`
  - `username`, `circuit`, `isAdmin` を返却
- [x] `template.yaml` に `ProfileFunction`（認証必要）
- [ ] `events/profile-event.json` 作成

---

### （廃止）POST `/user/password` — パスワード変更

> IF設計書: [forgetPass.md](IF/forgetPass.md)

フロントが Cognito に直接 `forgotPassword()` / `confirmPassword()` するため、
このAPI・`functions/auth/changePassword.mjs`・`ChangePasswordFunction` は削除済み。

---

### インフラ設定（Phase 2 共通）

- [x] Lambda Authorizer（`functions/auth/authorizer.mjs`）
  - Authorization ヘッダから Bearer トークン抽出
  - `aws-jwt-verify`（`CognitoJwtVerifier`）で Cognito ID トークンを JWKS 検証
  - IAM ポリシードキュメント（Allow / Deny）を返却。context に `username` を格納
- [x] Cognito User Pool ID / Client ID を Lambda 環境変数（`COGNITO_USER_POOL_ID` / `COGNITO_CLIENT_ID`）で参照
  - ※ JWT シークレットの SSM 登録は不要になった（自前JWT発行を廃止したため）
- [ ] API Gateway: CORS 設定・Authorizer 設定

### 動作確認（Phase 2）

- [ ] `sam build` && `sam local start-api`
- [ ] Cognito signUp → confirmRegistration → `/user` 登録 → Cognito authenticateUser → ID トークン取得 の一連フローをテスト
- [ ] 大会ID照会 / プロフィール取得（isAdmin含む）が正常動作することを確認
- [ ] Cognito forgotPassword → confirmPassword でパスワード再設定できることを確認
- [ ] トークンなしリクエストが 401 になることを確認

---

## Phase 3: コア API

---

### GET `/entries/init` — 初期データ取得

> IF設計書: [enterAuto1.md](IF/enterAuto1.md)　／　html_Enter/enterAuto.html・html_Enter/enterHand.html 共通

- [ ] `functions/entry/init.mjs`
  - EntryTable から車両番号・ドライバー情報を取得
  - `car_num`（配列）と `driver`（車番→ドライバー名配列のオブジェクト）を返却
- [ ] `template.yaml` に Function 追加
- [ ] `events/init-event.json` 作成

---

### POST `/entries/auto` — 自動入力送信

> IF設計書: [enterAuto2.md](IF/enterAuto2.md)

- [ ] `functions/pitlog/autoCreate.mjs`
  - バリデーション（`current` / `unsent`）
  - PitLogTable に `BatchWriteItem`
- [ ] `template.yaml` に Function 追加
- [ ] `events/auto-create-event.json` 作成

---

### POST `/entries/hand` — 手入力送信

> IF設計書: [enterHand2.md](IF/enterHand2.md)

- [ ] `functions/pitlog/handCreate.mjs`
  - バリデーション（`outDriver` / `inTime` / `outTime` / `garageInTime` / `tire` / `oil` / `note`）
  - PitLogTable に `PutItem`
- [ ] `template.yaml` に Function 追加
- [ ] `events/hand-create-event.json` 作成

---

### GET `/entries/update` — 変更対象ピット記録取得

> IF設計書: [enterUpdate1.md](IF/enterUpdate1.md)

- [ ] `functions/pitlog/updateGet.mjs`
  - クエリパラメータ `carNum` で PitLogTable を Query
  - EntryTable から `className`・`teamName` を取得してマージ
  - RetireTable を別途取得して Lambda でマージ
  - `garageInTime` が非 null の場合は `pitGap: null`
- [ ] `template.yaml` に Function 追加
- [ ] `events/update-get-event.json` 作成

---

### PUT `/entries/update` — 記録変更 / リタイア情報更新 / 取り消し

> IF設計書: [enterUpdate2.md](IF/enterUpdate2.md)

- [ ] `functions/pitlog/updatePut.mjs`
  - selection=1: PitLogTable の指定レコードを `UpdateItem`（ピット記録変更）
  - selection=2: RetireTable の `reason` を `UpdateItem`（リタイア情報更新）
  - selection=3: RetireTable の `is_retired` を false に `UpdateItem`（リタイア取り消し）
- [ ] `template.yaml` に Function 追加
- [ ] `events/update-put-event.json` 作成

---

### GET `/entries/retire` — リタイア登録 初期データ取得

> IF設計書: [enterRetire.md](IF/enterRetire.md)　／　html_Enter/enterRetire.html

- [ ] `functions/pitlog/retireGet.mjs`
  - EntryTable を全件 Scan（`maintenance_area` 昇順・`car_num` 昇順でソート）
  - RetireTable を全件 Scan して `car_num` でマージ
  - RetireTable に該当なしの場合は `is_retired: false / reason: ""`
- [ ] `template.yaml` に Function 追加
- [ ] `events/retire-get-event.json` 作成

---

### POST `/entries/retire` — リタイア登録

> IF設計書: [enterRetire2.md](IF/enterRetire2.md)

- [ ] `functions/pitlog/retireCreate.mjs`
  - バリデーション（`carNum` / `reason`（必須））
  - RetireTable に `PutItem`（`is_retired=true` / `reason`）
- [ ] `template.yaml` に Function 追加
- [ ] `events/retire-create-event.json` 作成

---

### GET `/entries/show` — 全ピット情報取得

> IF設計書: [showAll.md](IF/showAll.md)　／　showAll.html・output.html 共通

- [ ] `functions/pitlog/showAll.mjs`
  - PitLogTable を全件 Scan
  - RetireTable を全件 Scan
  - StartDriverTable を全件 Scan
  - Lambda 内で `car_num` をキーにマージ
  - `inDriver` の算出: `pit_num=1` は StartDriverTable の `driver`、`pit_num=2` 以降は前回ピットの `outDriver`
  - 論理チェック: `pit_num=2` 以降、前回ピットの `outDriver` と今回の `inDriver` が一致することを検証
  - `garageInTime` が非 null の場合は `pitGap: null`
  - クエリパラメータ `act=1` かつ `race_id` が指定されている場合、OutpostLogTable に `username`（JWTから取得）/ `race_id` / `created_at` を `PutItem`
- [ ] `template.yaml` に Function 追加
- [ ] `events/show-all-event.json` 作成

---

### 動作確認（Phase 3）

- [ ] `sam build` && `sam local start-api`
- [ ] エントリー一括登録 → スタートドライバー一括登録 → ピットログ記録 の一連フローをテスト
- [ ] 記録変更・リタイア情報更新・リタイア取り消しが正常動作することを確認
- [ ] リタイア登録（POST /entries/retire）→ リタイア取り消し（PUT /entries/update, selection=3）のフローをテスト
- [ ] GET API でデータが正しく返却されることを確認
- [ ] バリデーションエラー時に 400 が返却されることを確認

---

## 実装前確認 API（管理者用・1次情報登録系）

> 必要かどうか実装前に確認すること。

| メソッド | パス                       | 概要                              | Lambda ファイル候補                   | IF設計書                                                        |
| -------- | -------------------------- | --------------------------------- | ------------------------------------- | --------------------------------------------------------------- |
| POST     | `/entry/bulk`              | エントリー一括登録（CSV）         | `functions/entry/bulkCreate.mjs`      | [about the path of api.md](IF/about%20the%20path%20of%20api.md) |
| POST     | `/entry/start-driver/bulk` | スタートドライバー一括登録（CSV） | `functions/entry/bulkStartDriver.mjs` | [about the path of api.md](IF/about%20the%20path%20of%20api.md) |
| POST     | `/race`                    | レース登録                        | `functions/race/create.mjs`           | なし                                                            |
| GET      | `/race`                    | レース一覧取得                    | `functions/race/list.mjs`             | なし                                                            |
| POST     | `/entry`                   | エントリー1件登録                 | `functions/entry/create.mjs`          | なし                                                            |
| GET      | `/entry`                   | エントリー一覧取得                | `functions/entry/list.mjs`            | なし                                                            |
| DELETE   | `/entry/{car_num}`         | エントリー削除                    | `functions/entry/delete.mjs`          | なし                                                            |
| GET      | `/pitlog`                  | ピットログ一覧取得                | `functions/pitlog/list.mjs`           | なし                                                            |
