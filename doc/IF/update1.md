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

自動入力画面

# インターフェース仕様

変更したい車両の情報を表示する

## API パス

- `/entries/update`

## メソッド

- `GET`

## リクエスト

### クエリパラメータ

```json
{
  "carNum": "4" //変更したいゼッケン番号
}
```

### リクエストボディ

## レスポンス

### ステータスコード

- `200 OK`: 正常なレスポンス
- `400 Bad Request`: パラメータエラー
- `500 Internal Server Error`: サーバーエラー

### レスポンスボディ

変更したいゼッケン番号の全ピット記録を返す。キーはDBの管理ID（一意）。

```json
{
  "msg": "",
  "1": {
    "managerId": 1,
    "manager": "あそう太郎",
    "pitNum": 1,
    "carNum": 4,
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
    "carNum": 4,
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
