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

担当者が記録した内容をサーバに送る

## API パス

- `/entries/auto`

## メソッド

- `POST`

## リクエスト

### クエリパラメータ

| パラメータ  | 必須 | 説明                                                         |
| ----------- | :--: | ------------------------------------------------------------ |
| `race_id`   |  ○   | 大会ID。AWS authorizer が token（Bearer）と共に要求する認証用パラメータ。 |

※ 認証（token / race_id）以外の業務情報はクエリで送らず、リクエストボディで送る。

### リクエストボディ

`current` は今回の送信データ、`unsent` は前回送信に失敗し端末に保存されていたデータ。データがある車両のみ含まれる。

```json
{
  "current": {
    "5": {
      "inTime": "2026-05-06T10:00:00+09:00",
      "outTime": "2026-05-06T11:00:00+09:00",
      "garageInTime": null,
      "outDriver": "A",
      "tire": true, //boolean
      "oil": false, //boolean
      "note": "メモ"
    },
    "6": {
      "inTime": "2026-05-06T12:00:00+09:00",
      "outTime": null,
      "garageInTime": "2026-05-06T12:30:00+09:00",
      "outDriver": "B",
      "tire": false, //boolean
      "oil": true, //boolean
      "note": ""
    },
    "16": {
      "inTime": null,
      "outTime": "2026-05-06T12:30:00+09:00",
      "garageInTime": null,
      "outDriver": "B",
      "tire": false, //boolean
      "oil": true, //boolean
      "note": ""
    }
  },
  "unsent": {
    "15": {
      "inTime": "2026-05-06T12:00:00+09:00",
      "outTime": null,
      "garageInTime": "2026-05-06T12:30:00+09:00",
      "outDriver": "B",
      "tire": false, //boolean
      "oil": true, //boolean
      "note": ""
    }
  }
}
```

- `inTime` / `outTime` / `garageInTime`: ISO 8601形式（`+09:00`付き）。未入力は `null`
- `garageInTime`: ガレージストップ時のガレージイン時刻。`outTime` が `null` のときに使用
- `tire` / `oil`: `true` = 交換・補充あり、`false` = なし
- `unsent` が空オブジェクトの場合は前回の未送信データなし

## レスポンス

### ステータスコード

- `200 OK`: 正常なレスポンス（`msg`: 空文字）
- `400 Bad Request`: パラメータエラー（`msg`: エラー詳細）
- `401 Unauthorized`: 未ログイン（セッション切れ含む）（`msg`: エラー詳細）
- `500 Internal Server Error`: サーバーエラー（`msg`: エラー詳細）

### レスポンスボディ

```json
{
  "msg": "エラー内容"
}
```
