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
  - フィールド: `username`（担当者名）, `password`（bcrypt ハッシュ）, `organizationId`（OrganizationsTable の参照ID）
  - 備考: 会員番号は廃止。`username` は全データで一意

- [ ] OrganizationsTable（PK: `circuit`）
  - フィールド: `circuit`（サーキット番号 1-7）, `name`（組織名）,
  - 備考: UsersTable の `organizationId` から参照。conform2（GET /user/me）でサーキット情報取得時に 2-way クエリで結合する

- [ ] RaceTable（PK: `id`）
  - フィールド: `id`（UUID）, `title`（大会名）, `todayId`（大会ID・conform1 の POST で照合するパスワード相当）

- [ ] EntryTable（PK: `raceId`, SK: `carNum`）
  - フィールド: `raceId`, `carNum`（ゼッケン番号）, `className`（クラス）, `entrantName`（エントラント名称）,
    `vehicleName`（参加車両名称）, `maintenanceArea`（整備エリア）, `pitGarage`（ピットガレージ割り当て）,
    `driverA`〜`driverF`（ドライバー名、最大6名・未登録は null）
  - 変更: 旧定義（`pitNum`, `driverA` のみ）から拡張。エントラント名・車両名・クラス・整備エリア・ピットガレージ・ドライバーB〜F を追加

- [ ] PitLogTable（PK: `raceId`, SK: `id`, GSI: `CarNumIndex`）
  - フィールド: `raceId`, `id`（ULID）, `carNum`, `manager`（記録担当者名）, `pitNum`（ピット回数）,
    `inTime`, `outTime`, `garage_in_time`（ガレージイン時刻。ガレージストップ時のみ使用,NULL許容）,
    `inDriver`, `outDriver`, `tire`（boolean）, `oil`（boolean）, `note`
  - 変更: `manager`, `pitNum`, `garage_in_time`, `tire`, `oil`, `note` を追加。`retire` は RetireTable に分離
  - 備考: `pitGap`（ピット滞在秒数）は保存せず、APIレスポンス生成時に `outTime - inTime` で計算する

- [ ] RetireTable（PK: `raceId`, SK: `carNum`） ← 新規追加
  - フィールド: `raceId`, `carNum`, `retire`（boolean）, `reason`（リタイア理由）
  - 用途: update2（PUT /entries/update, selection=2）で書き込み。showAll / update1 レスポンスで参照

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

## Phase 2: 認証・ユーザー管理 API

### 〔認証〕ユーザ登録 API　`POST /user`

- [ ] `functions/auth/register.mjs` 作成
  - [ ] リクエストボディのバリデーション（username, password, organizationId）
  - [ ] パスワード強度チェック（6文字以上、大文字・小文字・数字必須）
  - [ ] `bcryptjs` でパスワードハッシュ化
  - [ ] UsersTable に `PutItem`（ConditionExpression で重複チェック）
  - [ ] 成功/エラーレスポンス返却
- [ ] `template.yaml` に `RegisterFunction` 追加（認証不要）
- [ ] `events/register-event.json` 作成（テスト用）
- [ ] `doc/IF/regist.md` IF仕様書確認

### 〔認証〕ログイン API　`POST /login`

- [ ] `functions/auth/login.mjs` 作成
  - [ ] リクエストボディのバリデーション（username, password）
  - [ ] UsersTable から `GetItem`（username で検索）
  - [ ] `bcryptjs` でパスワード照合
  - [ ] `jsonwebtoken` で JWT 発行（ペイロード: username, organizationId）
  - [ ] 成功/エラーレスポンス返却
- [ ] `template.yaml` に `LoginFunction` 追加（認証不要）
- [ ] `events/login-event.json` 作成（テスト用）
- [ ] `doc/IF/login.md` IF仕様書確認

### 〔認証〕大会ID照会 API　`POST /user/me`

- [ ] `functions/auth/conform.mjs` 作成
  - [ ] リクエストボディのバリデーション（todayId: 半角英数・15文字以上）
  - [ ] RaceTable から `Scan` して `today_id` と照合
  - [ ] 成功/エラーレスポンス返却
- [ ] `template.yaml` に `ConformFunction` 追加（認証必要）
- [ ] `events/conform-event.json` 作成（テスト用）
- [ ] `doc/IF/conform1.md` IF仕様書確認

### 〔ユーザー〕プロフィール取得 API　`GET /user/me`

- [ ] `functions/auth/profile.mjs` 作成
  - [ ] JWT から `username` を取得
  - [ ] UsersTable から `GetItem`（username で検索）
  - [ ] OrganizationsTable から `GetItem`（organizationId で検索）
  - [ ] `username`, `circuit` を返却
- [ ] `template.yaml` に `ProfileFunction` 追加（認証必要）
- [ ] `events/profile-event.json` 作成（テスト用）
- [ ] `doc/IF/conform2.md` IF仕様書確認

### 〔ユーザー〕パスワード変更 API　`POST /user/password`

- [ ] `functions/auth/changePassword.mjs` 作成
  - [ ] リクエストボディのバリデーション（username, password, newpassword: 半角英数大文字小文字・6文字以上）
  - [ ] UsersTable から `GetItem`（username で検索）
  - [ ] `bcryptjs` で現在パスワード照合
  - [ ] 新パスワード ≠ 現在パスワード チェック
  - [ ] `bcryptjs` で新パスワードハッシュ化 → UsersTable に `UpdateItem`
  - [ ] 成功/エラーレスポンス返却
- [ ] `template.yaml` に `ChangePasswordFunction` 追加（認証必要）
- [ ] `events/change-password-event.json` 作成（テスト用）
- [ ] `doc/IF/forgetPass.md` IF仕様書確認

### インフラ設定

- [ ] Lambda Authorizer（`functions/auth/authorizer.mjs`）
  - [ ] Authorization ヘッダから Bearer トークン抽出
  - [ ] `jsonwebtoken` で JWT 検証
  - [ ] IAM ポリシードキュメント（Allow/Deny）を返却
- [ ] JWT シークレット（SSM Parameter Store に登録・Lambda 環境変数 `JWT_SECRET` に参照を設定）
- [ ] API Gateway（CORS 設定・Authorizer 設定）

### 動作確認

- [ ] `sam build` && `sam local start-api`
- [ ] ユーザ登録 → ログイン → JWT取得 の一連フローをテスト
- [ ] 大会ID照会・プロフィール取得・パスワード変更が正常動作することを確認
- [ ] JWT 無しリクエストが 401 になることを確認

---

## Phase 3: コア API

### 〔レース管理〕レース登録 / 一覧取得

- [ ] `functions/race/create.mjs`　`POST /race`
  - [ ] バリデーション（title）・UUID 生成・RaceTable に `PutItem`
- [ ] `functions/race/list.mjs`　`GET /race`
  - [ ] RaceTable を `Scan` して返却
- [ ] 各 `template.yaml` Function 追加・`events/` 作成・`doc/IF/` 仕様書作成

### 〔エントリー管理〕エントリー CRUD + 一括登録

- [ ] `functions/entry/create.mjs`　`POST /entry`
  - [ ] バリデーション（raceId, carNum, className, entrantName, vehicleName, maintenanceArea, pitGarage, driverA〜driverF）・EntryTable に `PutItem`
- [ ] `functions/entry/bulkCreate.mjs`　`POST /entry/bulk`
  - [ ] CSV 受け取り・EntryTable に `BatchWriteItem`
- [ ] `functions/entry/bulkStartDriver.mjs`　`POST /entry/start-driver/bulk`
  - [ ] CSV 受け取り・EntryTable に `UpdateItem`（startDriver のみ更新）
- [ ] `functions/entry/list.mjs`　`GET /entry`
  - [ ] クエリパラメータ `raceId` で EntryTable を `Query`
- [ ] `functions/entry/delete.mjs`　`DELETE /entry/{carNum}`
  - [ ] EntryTable に `DeleteItem`（PK=raceId, SK=carNum）
- [ ] 各 `template.yaml` Function 追加・`events/` 作成・`doc/IF/` 仕様書作成

### 〔ピット監視〕初期データ取得 / 入力送信

- [ ] `functions/entry/init.mjs`　`GET /entries/init`
  - [ ] EntryTable から車両番号・ドライバー情報を取得して返却
- [ ] `functions/pitlog/autoCreate.mjs`　`POST /entries/auto`
  - [ ] バリデーション（current, unsent）・PitLogTable に `BatchWriteItem`
- [ ] `functions/pitlog/handCreate.mjs`　`POST /entries/hand`
  - [ ] バリデーション（carNum, outDriver, inTime, outTime, garageInTime, tire, oil, note）・PitLogTable に `PutItem`
- [ ] `functions/pitlog/update.mjs`　`PUT /pitlog/garage-out`
  - [ ] `outTime = NULL` のレコードを CarNumIndex で検索・`UpdateItem`（outTime / outDriver）
- [ ] 各 `template.yaml` Function 追加・`events/` 作成・`doc/IF/` 仕様書確認

### 〔ピット監視〕記録変更 / リタイア

- [ ] `functions/pitlog/updateGet.mjs`　`GET /entries/update`
  - [ ] クエリパラメータ `carNum` で PitLogTable + RetireTable を結合して返却
- [ ] `functions/pitlog/updatePut.mjs`　`PUT /entries/update`
  - [ ] selection=1: PitLogTable の指定レコードを `UpdateItem`
  - [ ] selection=2: RetireTable に `PutItem`（retire=true, reason）
- [ ] 各 `template.yaml` Function 追加・`events/` 作成・`doc/IF/` 仕様書確認

### 〔参照〕全ピット情報 / ピットログ一覧

- [ ] `functions/pitlog/showAll.mjs`　`GET /entries/show`
  - [ ] PitLogTable 全件取得・EntryTable / RetireTable 結合・garageInTime 非null 時は pitGap=null
- [ ] `functions/pitlog/list.mjs`　`GET /pitlog`
  - [ ] クエリパラメータ `raceId` または `carNum` で PitLogTable を `Query`
- [ ] 各 `template.yaml` Function 追加・`events/` 作成・`doc/IF/` 仕様書確認

### 動作確認

- [ ] `sam build` && `sam local start-api`
- [ ] レース作成 → エントリー一括登録 → スタートドライバー一括登録 → ピットログ記録 の一連フローをテスト
- [ ] ガレージストップ（POST /entries/auto → PUT /pitlog/garage-out）の2回送信フローをテスト
- [ ] 記録変更・リタイア登録が正常動作することを確認
- [ ] 各 GET API でデータが正しく返却されることを確認
- [ ] バリデーションエラー時に 400 が返却されることを確認
