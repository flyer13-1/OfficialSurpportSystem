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

記録変更画面

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

- `200 OK`: 正常なレスポンス（`msg`: 空文字）
- `400 Bad Request`: パラメータエラー（`msg`: エラー詳細）
- `401 Unauthorized`: 未ログイン（セッション切れ含む）（`msg`: エラー詳細）
- `500 Internal Server Error`: サーバーエラー（`msg`: エラー詳細）

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
    "className": "st1",      //EntryTable から carNum で結合
    "teamName": "TeamA",     //EntryTable から carNum で結合
    "retire": false,         //boolean。RetireTable から carNum で結合
    "inDriver": "A",
    "outDriver": "B",
    "inTime": "2026-05-06T10:00:00+09:00",
    "outTime": "2026-05-06T11:00:00+09:00",
    "garageInTime": null,    //ガレージイン時刻。非null の場合は pitGap が null
    "pitGap": 3600,          //DB保存なし。outTime - inTime（秒）をレスポンス生成時に計算。garageInTime が非null の場合は null
    "tire": true,            //boolean
    "oil": false,            //boolean
    "note": "メモ"
  },
  "2": {
    "managerId": 2,
    "manager": "あそう太郎",
    "pitNum": 2,
    "carNum": 4,
    "className": "st1",
    "teamName": "TeamA",
    "retire": false,         //boolean
    "inDriver": "B",
    "outDriver": "A",
    "inTime": "2026-05-06T15:00:00+09:00",
    "outTime": "2026-05-06T16:00:00+09:00",
    "garageInTime": null,
    "pitGap": 3600,
    "tire": false,
    "oil": true,
    "note": ""
  }
}
```
