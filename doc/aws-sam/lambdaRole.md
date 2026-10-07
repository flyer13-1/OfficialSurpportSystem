# Lambda実行ロール設計書

対象: OfficialSupportSystem — backend-sam/template.yaml で定義するLambda用IAMロール
作成日: 2026-09-18

---

## 1. ロール一覧

| ロール名               | 用途                                                       | 割り当て対象Function                    |
| ---------------------- | ------------------------------------------------------------ | ---------------------------------------- |
| LambdaExecutionRole    | 全Lambda共通ロール。DynamoDB全操作を許可                    | 左記の専用ロール以外の全Function |
| AuthLambdaRole         | 登録前後で担当者名を扱う未認証系Function専用。最小権限ロール | RegisterFunction / CheckUsernameFunction |
| ConformLambdaRole      | 大会ID照会専用。`TodayIdIndex`のQueryと署名鍵(SSM)の読み取りのみ許可の最小権限ロール | ConformFunction（POST /user/me） |
| ProfileLambdaRole      | プロフィール取得専用。UsersTableの参照(GetItem)のみ許可の最小権限ロール | ProfileFunction（GET /user/me） |

---

## 2. AuthLambdaRole（追加分）

### 2.1 追加理由

RegisterFunction（`POST /user`、ユーザー登録処理）は認証不要のエンドポイントであり、
Users・Organizationsテーブル以外へのアクセスは本来不要。
LambdaExecutionRole（DynamoDB全テーブル全操作を許可）をそのまま使うと、
未認証で叩けるエンドポイントが必要以上に広い権限を持つことになるため、
最小権限の原則に従い専用ロールを切り出した。

### 2.2 付与権限

| テーブル           | 許可アクション                    | 理由                                                                 |
| ------------------ | ---------------------------------- | --------------------------------------------------------------------- |
| OrganizationsTable | `dynamodb:GetItem`                 | 登録時に所属組織（circuit）の存在確認に使用                          |
| UsersTable         | `dynamodb:PutItem`                 | Cognitoのsub + username + circuitを新規登録                          |
| UsersTable         | `dynamodb:Scan`                    | CheckUsernameFunctionが担当者名の空き確認に使用（checkUsername.md） |

- 上記アクション・テーブル以外への `Resource` は含めない（`Resource: "*"` は使用しない）
- `ManagedPolicyArns` は `AWSLambdaBasicExecutionRole`（CloudWatch Logs書き込み）のみ付与し、LambdaExecutionRoleと同一

### 2.3 定義箇所

- `backend-sam/template.yaml` の `AuthLambdaRole`（`AWS::IAM::Role`）
- 割り当て:
  - `RegisterFunction.Properties.Role: !GetAtt AuthLambdaRole.Arn`
  - `CheckUsernameFunction.Properties.Role: !GetAtt AuthLambdaRole.Arn`

### 2.4 CheckUsernameFunctionについて

`GET /user/check` — Cognitoの`signUp`を呼ぶ**前**にフロントが担当者名の空きを確認するための
エンドポイント。詳細は `doc/aws-sam/checkUsername.md` 参照。

RegisterFunction側の重複チェックは、Cognito登録が完了した**後**にしか弾けず、失敗すると
Cognito側にユーザーが残る「孤児アカウント」が発生し得る（`doc/aws-sam/cognitoSetting.md`
6章の保留物参照）。signUp前に事前チェックを挟むことでこの発生を抑える狙い。ただしチェックと
signUpの間には短いレースコンディションが残るため、最終的な重複防止は引き続き
RegisterFunction側の`Scan`チェック（register.mjs参照）が担う。

UsersTableのPKは`cognito_sub`のため、空き確認は`GetItem`ではなく
`Scan`＋`FilterExpression`で行っている。
（かつては「conform.mjsのRaceTable検索と同じ方式」と書いていたが、conform側は02章の実装で
`TodayIdIndex`のQueryに変わったため §3.2 を参照。こちらは今も`Scan`のまま。
なお `UsersTable` には03章§4.2で `UsernameIndex` を追加済みで、pit_assignment の
登録済み確認はそちらを使う。空き確認を索引に寄せるかは別途判断。）
RegisterFunction側の重複チェックも同じ理由で`Scan`方式に変更済み（PKがcognito_subのため、
PutItemの`ConditionExpression`だけでは担当者名の重複を検出できない）。

### 2.5 register.mjs / profile.mjsのcognito_sub対応（修正済み）

以前はUsersTableのPK移行（username→cognito_sub）後もregister.mjs / profile.mjsが
`username`をキーとして扱ったままになっていた（実装漏れ）。以下の対応で修正済み。

- register.mjs: `PutItem`のItemに`cognito_sub`を含めるよう修正し、`ConditionExpression`は
  `attribute_not_exists(cognito_sub)`（二重送信対策）に変更。担当者名の重複チェックは
  上記の通り`Scan`方式に変更
- authorizer.mjs: contextに`sub`（Cognitoのcognito_sub）を追加。既存の`username`
  （`cognito:username`クレーム）はCognitoのサインイン設定変更でメールアドレスになっており
  担当者名としては使えないため、UsersTable参照には使わない
- profile.mjs: `GetItem`のKeyを`{ username }`から`{ cognito_sub: sub }`に変更（`sub`はauthorizerのcontextから取得）

---

## 3. ConformLambdaRole（追加分）

### 3.1 追加理由

ConformFunction（`POST /user/me`、大会ID照会）はRaceTableから`today_id`が一致するレースを
探して`raceToken`を返すだけの処理で、書き込みや他テーブルへのアクセスは不要。
LambdaExecutionRole（全テーブル全操作）を使う必要がないため、最小権限の専用ロールに分離した。

### 3.2 付与権限（2026-10-07更新）

| 対象                         | 許可アクション       | 理由                                                                                      |
| ---------------------------- | -------------------- | ----------------------------------------------------------------------------------------- |
| `RaceTable/index/TodayIdIndex` | `dynamodb:Query`     | `today_id`での照合。**02章の実装で Scan + FilterExpression から GSI の Query に変更した** |
| SSM `race-token-secret`        | `ssm:GetParameter`   | `raceToken` の署名鍵の読み取り（[raceIdToken.md](../IF/raceIdToken.md) §6）                |

- 読み取り専用（Put/Update/Delete等は付与しない）。
- **`Resource` は RaceTable 本体ではなく `TodayIdIndex` のARNのみ。** 索引経由の Query しか
  行わないため、テーブル本体への GetItem / Scan は付与しない。
- 署名鍵は `SecureString` のため `WithDecryption: true` で取得する。ポリシー名は
  `RaceTokenSecretReadPolicy`（RaceDataLambdaRole にも同じものがある）。
- `ManagedPolicyArns`は`AWSLambdaBasicExecutionRole`のみ（他ロールと同一）

### 3.3 定義箇所

- `backend-sam/template.yaml`の`ConformLambdaRole`
- 割り当て: `ConformFunction.Properties.Role: !GetAtt ConformLambdaRole.Arn`

---

## 4. ProfileLambdaRole（追加分）

### 4.1 追加理由

ProfileFunction（`GET /user/me`）はUsersTableを`cognito_sub`で`GetItem`するだけの処理。
全テーブル全操作のLambdaExecutionRoleを使う必要がないため、最小権限の専用ロールに分離した。
既存の`AuthLambdaRole`はUsersTable権限が`PutItem`/`Scan`のみで`GetItem`が無く流用できない。
また`AuthLambdaRole`に`GetItem`を足す案もあったが、同ロールは認証なしで叩ける`POST /user`・
`GET /user/check`が使うロールのため、認証が必要なプロフィール取得のために未認証側の権限を
広げない方針とした。

### 4.2 付与権限

| テーブル   | 許可アクション    | 理由                                          |
| ---------- | ----------------- | --------------------------------------------- |
| UsersTable | `dynamodb:GetItem` | `cognito_sub`でプロフィール（担当者名・所属）を取得 |

- 読み取り専用。`Resource`はUsersTableのARNのみ
- `ManagedPolicyArns`は`AWSLambdaBasicExecutionRole`のみ（他ロールと同一）

### 4.3 定義箇所

- `backend-sam/template.yaml`の`ProfileLambdaRole`
- 割り当て: `ProfileFunction.Properties.Role: !GetAtt ProfileLambdaRole.Arn`

**保留物**

- 上記以外のFunctionについても、アクセス先テーブルを絞った専用ロールへの分割は未対応（現状はLambdaExecutionRoleを使用）。今後の権限最小化タスクとして検討
- authorizer.mjsの`username`（`cognito:username`クレーム）がメールアドレスになった影響で、これを担当者名だと思って使っている11個のFunction（autoCreate / handCreate / updatePut / retireCreate / retireGet / updateGet / showAll / init / bulkEntry / bulkStartDriver、および直したprofile.mjs以外）が、記録者名・担当割り当て等をメールアドレスで保存/検索してしまう状態のまま。今回は対応を見送り、別issueとして扱う
