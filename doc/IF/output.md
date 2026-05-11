# API 設計書

- [API 設計書](#api-設計書)
- [概要](#概要)
- [インターフェース仕様](#インターフェース仕様)
  - [API パス](#api-パス)
  - [メソッド](#メソッド)
  - [リクエスト](#リクエスト)
    - [クエリパラメータ](#クエリパラメータ)
    - [リクエストボディ](#リクエストボディ)
  - [レスポンス](#レスポンス)
    - [ステータスコード](#ステータスコード)
    - [レスポンスボディ](#レスポンスボディ)

# 概要

確認画面

# インターフェース仕様

全てのピット情報を送信してフロントでcvsファイルにする

## API パス

- `/entries/output`

## メソッド

- `GET`

## リクエスト

### クエリパラメータ

なし

### リクエストボディ

## レスポンス

### ステータスコード

- `200 OK`: 正常なレスポンス
- `400 Bad Request`: パラメータエラー
- `401 Unauthorized`: 未ログイン（セッション切れ含む）
- `500 Internal Server Error`: サーバーエラー

### レスポンスボディ

```json
{
  "msg": "", //準正常系・正常終了した場合は空文字
  //キーはDBの管理ID（一意）。車番は複数回ピットインで重複するため管理IDを使用
  "1": {
    "managerId": 1,
    "manager": "あそう太郎",
    "pitNum": 1,
    "carNum": 5,
    "className": "st1",
    "teamName": "TeamA",
    "retire": false, //boolean
    "inDriver": "A",
    "outDriver": "B",
    "inTime": "2026-05-06T10:00:00+09:00",
    "outTime": "2026-05-06T11:00:00+09:00",
    "pitGap": 3600
  },
  "2": {
    "managerId": 2,
    "manager": "あそう太郎",
    "pitNum": 2,
    "carNum": 5,
    "className": "st1",
    "teamName": "TeamA",
    "retire": false, //boolean
    "inDriver": "B",
    "outDriver": "A",
    "inTime": "2026-05-06T15:00:00+09:00",
    "outTime": "2026-05-06T16:00:00+09:00",
    "pitGap": 3600
  }
}
```
