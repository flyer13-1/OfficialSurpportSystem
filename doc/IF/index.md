# API 設計書

- [API 設計書](#api-設計書)
- [概要](#概要)
- [インターフェース仕様](#インターフェース仕様)

# 概要

ログイン画面の設定

# インターフェース仕様

**バックエンド API はない。** フロントエンドが Cognito User Pool に直接認証する
（common.js の `cognitoPool` を使用）。

- User Pool ID: `us-east-1_P6B4NaQPe`
- Client ID: `7i8g9mqjr6a932isnp7nkl1csj`

## フロントエンドの処理（a_js/login.js）

1. `AmazonCognitoIdentity.AuthenticationDetails` に担当者名・パスワードを渡す
   - 担当者名: ひらがな・カタカナ・漢字、4〜20文字
   - パスワード: 半角英数字の大文字小文字を含む、6〜20文字
2. `CognitoUser.authenticateUser()` を呼ぶ
3. 成功時: `result.getIdToken().getJwtToken()` を `sessionStorage.getItem("token")` に保存し、
   確認画面（conform.html）へ遷移する。以降の API 呼び出しは
   `Authorization: Bearer <IDトークン>` で送る（Lambda Authorizer が JWKS 検証する）
4. 失敗時: `onFailure` のエラーメッセージを表示する

## バックエンド側の変更

- `POST /login` Lambda（login.mjs）・自前 JWT 発行は**廃止**。
- Lambda Authorizer（authorizer.mjs）が Cognito の ID トークンを JWKS で検証し、
  `cognito:username` クレームを `requestContext.authorizer.username` として後続 Lambda に渡す。
