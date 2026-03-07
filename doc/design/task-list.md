# AWS SAM 移行 作業一覧（Phase 0 〜 Phase 3）

## Phase 0: 準備

- [ ] SAMプロジェクトスケルトン作成（`sam init`）
- [ ] `template.yaml` の基本構造を作成
  - [ ] Parameters セクション（Env）
  - [ ] Globals セクション（Runtime, Timeout, MemorySize, Architectures, Environment）
  - [ ] DynamoDB テーブル 5つの定義（UsersTable, OrganizationsTable, RaceTable, EntryTable, PitLogTable）
- [ ] `.gitignore` 更新（`.aws-sam/`, `node_modules/`, `*.js.map`）
- [ ] ディレクトリ構造の作成
  - [ ] `layers/common/nodejs/`
  - [ ] `functions/auth/`
  - [ ] `functions/entry/`
  - [ ] `functions/pitlog/`
  - [ ] `functions/race/`
  - [ ] `events/`
  - [ ] `tests/`

---

## Phase 1: インフラ基盤 + 共通 Layer

### DynamoDB テーブル定義（template.yaml）

- [ ] UsersTable（PK: `username`）
- [ ] OrganizationsTable（PK: `id`）
- [ ] RaceTable（PK: `id`）
- [ ] EntryTable（PK: `raceId`, SK: `carNum`）
- [ ] PitLogTable（PK: `raceId`, SK: `id`, GSI: `CarNumIndex`）
- [ ] 全テーブルの BillingMode を `PAY_PER_REQUEST` に設定

### Lambda Layer 実装

- [ ] `layers/common/nodejs/package.json` 作成
  - [ ] 依存関係: `@aws-sdk/lib-dynamodb`, `@aws-sdk/client-dynamodb`, `bcryptjs`, `jsonwebtoken`
- [ ] `layers/common/nodejs/dynamodb.js` 作成
  - [ ] `DynamoDBClient` + `DynamoDBDocumentClient` のシングルトン生成
  - [ ] 環境変数からテーブル名を取得するヘルパー関数
- [ ] `template.yaml` に `CommonLayer`（`AWS::Serverless::LayerVersion`）を追加
- [ ] `npm install`（Layer の依存関係インストール）

### デプロイ確認

- [ ] `sam build`
- [ ] `sam deploy` でスタック作成
- [ ] AWS コンソールで DynamoDB テーブル 5つの作成を確認

---

## Phase 2: 認証 API

### ユーザ登録 API

- [ ] `functions/auth/register.mjs` 作成
  - [ ] リクエストボディのバリデーション（username, password, nickname, organizationId）
  - [ ] パスワード強度チェック（8文字以上、大文字・小文字・数字必須）
  - [ ] `bcryptjs` でパスワードハッシュ化
  - [ ] UsersTable に `PutItem`（ConditionExpression で重複チェック）
  - [ ] 成功/エラーレスポンス返却
- [ ] `template.yaml` に `RegisterFunction` 追加（`POST /auth/register`, 認証不要）
- [ ] `events/register-event.json` 作成（テスト用）
- [ ] `doc/IF/auth-register.md` IF仕様書作成

### ログイン API

- [ ] `functions/auth/login.mjs` 作成
  - [ ] リクエストボディのバリデーション（username, password）
  - [ ] UsersTable から `GetItem`（username で検索）
  - [ ] `bcryptjs` でパスワード照合
  - [ ] `jsonwebtoken` で JWT 発行（ペイロード: username, nickname, organizationId）
  - [ ] 成功/エラーレスポンス返却
- [ ] `template.yaml` に `LoginFunction` 追加（`POST /auth/login`, 認証不要）
- [ ] `events/login-event.json` 作成（テスト用）
- [ ] `doc/IF/auth-login.md` IF仕様書作成

### Lambda Authorizer

- [ ] `functions/auth/authorizer.mjs` 作成
  - [ ] Authorization ヘッダから Bearer トークン抽出
  - [ ] `jsonwebtoken` で JWT 検証
  - [ ] IAM ポリシードキュメント（Allow/Deny）を返却
- [ ] `template.yaml` に `AuthorizerFunction` 追加
- [ ] `template.yaml` の HttpApi に DefaultAuthorizer を設定

### JWT シークレット管理

- [ ] SSM Parameter Store に JWT 秘密鍵を登録（SecureString）
- [ ] `template.yaml` に `JwtSecret` パラメータ追加
- [ ] Lambda 環境変数 `JWT_SECRET` に参照を設定

### API Gateway 設定

- [ ] `template.yaml` に `OfficialSupportApi`（`AWS::Serverless::HttpApi`）追加
  - [ ] CORS 設定
  - [ ] Authorizer 設定（`/auth/*` は認証不要）

### 動作確認

- [ ] `sam build` && `sam local start-api`
- [ ] ユーザ登録 → ログイン → JWT取得 の一連フローをテスト
- [ ] JWT 無しリクエストが 401 になることを確認
- [ ] 重複ユーザ登録が 400 になることを確認
- [ ] パスワード不一致が 401 になることを確認

---

## Phase 3: コア API

### エントリー登録 API

- [ ] `functions/entry/create.mjs` 作成
  - [ ] リクエストボディのバリデーション（raceId, carNum, pitNum, driverA）
  - [ ] EntryTable に `PutItem`
  - [ ] 成功/エラーレスポンス返却
- [ ] `template.yaml` に `EntryCreateFunction` 追加（`POST /entry`）
- [ ] `events/entry-create-event.json` 作成
- [ ] `doc/IF/entry-create.md` IF仕様書作成

### エントリー一覧取得 API

- [ ] `functions/entry/list.mjs` 作成
  - [ ] クエリパラメータ `raceId` を取得
  - [ ] EntryTable に `Query`（PK=raceId）
  - [ ] レスポンス返却
- [ ] `template.yaml` に `EntryListFunction` 追加（`GET /entry`）
- [ ] `events/entry-list-event.json` 作成
- [ ] `doc/IF/entry-list.md` IF仕様書作成

### エントリー削除 API

- [ ] `functions/entry/delete.mjs` 作成
  - [ ] パスパラメータ `carNum` とクエリパラメータ `raceId` を取得
  - [ ] EntryTable に `DeleteItem`（PK=raceId, SK=carNum）
  - [ ] 成功/エラーレスポンス返却
- [ ] `template.yaml` に `EntryDeleteFunction` 追加（`DELETE /entry/{carNum}`）
- [ ] `events/entry-delete-event.json` 作成
- [ ] `doc/IF/entry-delete.md` IF仕様書作成

### ピットログ登録 API

- [ ] `functions/pitlog/create.mjs` 作成
  - [ ] リクエストボディのバリデーション（raceId, carNum, inTime, outTime, inDriver, outDriver）
  - [ ] ULID で一意な ID を生成
  - [ ] PitLogTable に `PutItem`
  - [ ] 成功/エラーレスポンス返却
- [ ] `template.yaml` に `PitLogCreateFunction` 追加（`POST /pitlog`）
- [ ] `events/pitlog-create-event.json` 作成
- [ ] `doc/IF/pitlog-create.md` IF仕様書作成

### ピットログ一覧取得 API

- [ ] `functions/pitlog/list.mjs` 作成
  - [ ] クエリパラメータ `raceId` または `carNum` を取得
  - [ ] `raceId` 指定時: PitLogTable に `Query`（PK=raceId）
  - [ ] `carNum` 指定時: GSI `CarNumIndex` に `Query`（PK=carNum）
  - [ ] レスポンス返却
- [ ] `template.yaml` に `PitLogListFunction` 追加（`GET /pitlog`）
- [ ] `events/pitlog-list-event.json` 作成
- [ ] `doc/IF/pitlog-list.md` IF仕様書作成

### レース登録 API

- [ ] `functions/race/create.mjs` 作成
  - [ ] リクエストボディのバリデーション（title）
  - [ ] UUID で一意な ID を生成
  - [ ] RaceTable に `PutItem`
  - [ ] 成功/エラーレスポンス返却
- [ ] `template.yaml` に `RaceCreateFunction` 追加（`POST /race`）
- [ ] `events/race-create-event.json` 作成
- [ ] `doc/IF/race-create.md` IF仕様書作成

### レース一覧取得 API

- [ ] `functions/race/list.mjs` 作成
  - [ ] RaceTable を `Scan`
  - [ ] レスポンス返却
- [ ] `template.yaml` に `RaceListFunction` 追加（`GET /race`）
- [ ] `events/race-list-event.json` 作成
- [ ] `doc/IF/race-list.md` IF仕様書作成

### 動作確認

- [ ] `sam build` && `sam local start-api`
- [ ] レース作成 → エントリー登録 → ピットログ記録 の一連フローをテスト
- [ ] 各 GET API でデータが正しく返却されることを確認
- [ ] エントリー削除後に一覧から消えることを確認
- [ ] バリデーションエラー時に 400 が返却されることを確認
