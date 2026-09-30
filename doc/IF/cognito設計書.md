# Cognito設計書

対象: OfficialSupportSystem — login / forgetpass / regist のCognito移行
作成日: 2026-09-18

---

## 1. サインインエクスペリエンス

| 設定項目 | 簡潔な設定内容 |
|---|---|
| Sign-in options | Emailのみ（Username、Phone numberは使用しない） |
| Cognito割り当てusername | 不要（emailをそのままusernameとして扱う） |
| 大文字小文字の区別 | 区別しない（Case insensitive） |

**保留物**
- なし（確定事項）

---

## 2. セキュリティ要件

| 設定項目 | 簡潔な設定内容 |
|---|---|
| パスワードポリシー | 最小長6文字 / 大文字必須ON / 小文字必須ON / 数字必須ON / 記号必須OFF（既存フロントのチェック仕様に合わせる） |
| MFA | なし |
| アカウント復旧方法 | Email only |

**保留物**
- なし（確定事項）

---

## 3. サインアップエクスペリエンス

| 設定項目 | 簡潔な設定内容 |
|---|---|
| セルフサインアップ | 有効 |
| 属性検証 | emailを確認コードで検証 |
| 必須属性 | emailのみ |
| カスタム属性 | 追加不要（担当者名・所属組織はDynamoDB側で管理するため） |
| leader（役職）管理 | Cognito User Pool Groups機能を使用。新規登録者は初期状態でどのグループにも未所属＝一般担当者扱い。既存leaderが管理画面から昇格させる運用 |
| circuit（所属組織）管理 | DynamoDB側で管理（詳細は6章参照） |

**保留物**
- なし（確定事項）

---

## 4. メッセージ配信

| 設定項目 | 簡潔な設定内容 |
|---|---|
| メール送信元 | 開発中はCOGNITO_DEFAULT（FROMアドレス: `no-reply@verificationemail.com` 固定） |
| メール文面 | Cognitoコンソール上で日本語の文言に軽くカスタマイズ |
| 上限超過時の挙動 | SignUp等のAPIが `LimitExceededException` を返す。ユーザーはUNCONFIRMED状態で作成される（確認コード未着）。呼び出し元でtry-catchし「時間をおいて再度お試しください」等のメッセージを表示する設計とする |
| 適用範囲の注意 | この日次メール送信枠は、サインアップ確認コードだけでなく、Cognitoの `ForgotPassword`（パスワード再設定）等、デフォルトメール送信全般で共有される |

**保留物**
- forget.htmlがCognitoの `ForgotPassword` / `ConfirmForgotPassword`（メールでコード送信する方式）を使う設計かどうかの最終確認
- **本番前のSES切り替え準備（必須タスク）**：ドメイン/メールアドレスのSES検証、およびサンドボックス解除（本番アクセス）申請を大会本番の前に済ませておく（審査に24時間〜数日かかるため、当日の即時対応はできない）

---

## 5. アプリケーション統合

| 設定項目 | 簡潔な設定内容 |
|---|---|
| クライアントシークレット | 生成しない（SPA/フロントJSからの直接呼び出しのため） |
| 認証フロー | `ALLOW_USER_PASSWORD_AUTH` + `ALLOW_REFRESH_TOKEN_AUTH` を有効化（SRP未使用のため `ALLOW_USER_SRP_AUTH` は不要） |
| トークン有効期限 | デフォルトのまま（access/idトークン: 1時間、refresh token: 30日）。トークンはsessionStorage管理でタブを閉じれば消えるため実害なし |
| ユーザー存在エラー防止 | ENABLED |

**保留物**
- なし（確定事項）

---

## 6. Lambdaトリガー

| 設定項目 | 簡潔な設定内容 |
|---|---|
| Pre sign-up trigger | 不要（招待制ではなくセルフサインアップのため） |
| サインアップ後のDB登録方式 | Cognitoの自動トリガーは使わず、フロントが確認完了（ConfirmSignUp成功）後に既存の `POST /user`（RegisterFunction）を手動で呼び出し、sub + username + circuit をDynamoDBに書き込む |
| サインイン方式 | Cognitoの `InitiateAuth` でトークン発行。画面遷移はフロント側のJSが制御 |

**保留物**
- Post confirmation Lambdaトリガーの実装（今回は保留。1か月での完成を優先し、余力があれば保険として後付けする）
- フロント駆動方式のリスク：ConfirmSignUp成功後にRegisterFunction呼び出しが失敗すると、Cognito側にユーザーが存在するがDynamoDBにレコードがない「孤児アカウント」が発生し得る（現状は許容前提で進行）

---

## 7. その他

| 設定項目 | 簡潔な設定内容 |
|---|---|
| 削除保護（Deletion Protection） | 有効化 |
| 高度なセキュリティ機能（漏洩パスワード検知等） | 使用しない |

**保留物**
- なし（確定事項）
