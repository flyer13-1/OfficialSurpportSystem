# API 設計書

- [API 設計書](#api-設計書)
- [概要](#概要)
- [インターフェース仕様](#インターフェース仕様)
- [ログイン画面の入力検証](#ログイン画面の入力検証)

共通処理（認証ガード・エラー処理・区画切り替え・入力検証の判定表）は
[common.md](common.md) を参照。

# 概要

ログイン画面の設定

# インターフェース仕様

**バックエンド API はない。** フロントエンドが Cognito User Pool に直接認証する
（common.js の `cognitoPool` を使用）。

- User Pool ID: `ap-northeast-1_tGblsfFgk`
- Client ID: `6lh05mp69vfns3cfpj6hls4e7i`

同じ値を Lambda 側でも使う（`template.yaml` の `COGNITO_USER_POOL_ID` /
`COGNITO_CLIENT_ID`。Lambda Authorizer のトークン検証に必要）。
**片方だけ変えると認証が通らなくなるため、変更時は必ず両方を揃える。**

## ログインIDはメールアドレス

Cognito のサインイン設定を「Email のみ」にしている（[cognitoSetting.md](../aws-sam/cognitoSetting.md) §1）ため、
**ログインに使うのはメールアドレスであり、担当者名ではない。**

- 画面の入力欄は `<input type="email" id="username">`（id は `username` だが中身はメールアドレス）
- 担当者名（`users.username`）はアプリ側の DynamoDB だけが持つ値で、ログインには使わない

## フロントエンドの処理（a_js/login.js）

1. `AmazonCognitoIdentity.AuthenticationDetails` にメールアドレス・パスワードを渡す
2. `CognitoUser.authenticateUser()` を呼ぶ
   - **認証フローは SRP（`USER_SRP_AUTH`）。** SDK（amazon-cognito-identity-js v6）の既定値であり、
     `setAuthenticationFlowType()` は呼んでいない。パスワードそのものは送らず、ブラウザ内で
     計算した証明値を送る方式。有効にしている認証フローは `ALLOW_USER_SRP_AUTH` と
     `ALLOW_REFRESH_TOKEN_AUTH` の2つで、`ALLOW_USER_PASSWORD_AUTH` は使わないため無効
     （[cognitoSetting.md](../aws-sam/cognitoSetting.md) §5）
3. 成功時: `result.getIdToken().getJwtToken()` を `sessionStorage.setItem("token", ...)` で保存し、
   確認画面（conform.html）へ遷移する。以降の API 呼び出しは
   `Authorization: Bearer <IDトークン>` で送る（Lambda Authorizer が JWKS 検証する）
4. 失敗時: `onFailure` のエラーメッセージを表示する

## バックエンド側の変更

- `POST /login` Lambda（login.mjs）・自前 JWT 発行は**廃止**。
- Lambda Authorizer（authorizer.mjs）が Cognito の ID トークンを JWKS で検証し、
  次の3つを `requestContext.authorizer` に載せて後続 Lambda に渡す。

| キー       | 中身                                                              | 注意                                                                                                                      |
| ---------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `username` | `cognito:username` クレーム                                       | **担当者名ではなくメールアドレス。** 担当者名が必要な場合は `sub` で UsersTable を引く（`profile.mjs` がその例）           |
| `sub`      | `sub` クレーム（Cognito の利用者識別子）                          | UsersTable の PK（`cognito_sub`）そのもの。所属サーキットの取得はこれで引く                                               |
| `isAdmin`  | `cognito:groups` に `leader` が含まれるか                         | **後続 Lambda には `"true"` / `"false"` の文字列で届く**（Lambda Authorizer の context は真偽値を文字列化する）            |

- 権限の判定そのものは Authorizer では行わない。トークンが通った人には API 全体を許可し、
  leader・サーキット・race の期限は各 Lambda が判断する
  （[01_permission.md](../aws-sam/admin/v2/01_permission.md) §3）。

# ログイン画面の入力検証

**ログイン画面は強度チェックを行わない。** 検証は `<form>` の標準機能だけに任せる
（2026-10-06 決定。[common.md](common.md#ログイン画面は判定表の対象外)）。
ログインは「既に決まっているパスワードを入れる」操作であり、登録時の強度規則を
再主張する意味がないため。

| 検証したいこと           | 効かせる方法                       |
| ------------------------ | ---------------------------------- |
| メールアドレスが空でない | `required`                         |
| メールアドレスの形式     | `type="email"`                     |
| パスワードが空でない     | `required`                         |
| パスワードが6〜20文字    | `minlength="6"` / `maxlength="20"` |

**これが効く理由:** 送信は実際の `<form>` の submit で、ブラウザの制約検証は
**submit イベントが発火する前**に走る。不合格なら `login.js` のハンドラ自体が呼ばれない。

- `passCheck.js` は読み込まない。送信ボタンは常に有効のまま。
- 強度規則（大文字・小文字・数字・半角英数字のみ）が適用されるのは
  **登録（regist）とパスワード再設定（forgetPass）の2画面だけ**
  （[common.md](common.md#パスワードの強度規則regist--forgetpass-の2画面)）。

**Cognito コンソールからパスワードを設定する場合は、半角英数字のみ・20文字以内にすること。**
記号はログインを妨げないが、`maxlength="20"` のため21文字以上は入力欄に収まらない。
