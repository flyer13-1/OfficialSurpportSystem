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

確認画面・出力画面（共通API）

# インターフェース仕様

全ピット情報を全件取得する。showAll.html および output.html が使用する

## API パス

- `/entries/show`

## メソッド

- `GET`

## リクエスト

### クエリパラメータ

なし

### リクエストボディ

## レスポンス

### ステータスコード

- `200 OK`: 正常なレスポンス（`msg`: 空文字）
- `400 Bad Request`: パラメータエラー（`msg`: エラー詳細）
- `401 Unauthorized`: 未ログイン（セッション切れ含む）（`msg`: エラー詳細）
- `403 Forbidden`: トークンが不正、または終了済みのレース（`reason: "race_finished"`）。担当エリア外の車両を指定した場合も 403（01章 §5.4）
- `500 Internal Server Error`: サーバーエラー（`msg`: エラー詳細）

### レスポンスボディ

> **`garageInTime` は廃止した（2026-10-04）。** 既存データに値が入った記録は無いことを確認済み（04章§2.5）。
> 以下の例に残っている `garageInTime` は無効で、リクエストに含めても無視され、レスポンスにも入らない。
> `pitGap` は `inTime` と `outTime` の両方が揃っているときだけ算出し、片方でも欠ければ `null`。

```json
{
  "msg": "",
  //キーはDBの管理ID（一意）。車番は複数回ピットインで重複するため管理IDを使用
  "1": {
    "managerId": 1,
    "manager": "あそう太郎",
    "pitNum": 1,
    "carNum": 5,
    "className": "st1", //EntryTable から carNum で結合
    "teamName": "TeamA", //EntryTable から carNum で結合
    "retire": false, //boolean。RetireTable から carNum で結合
    "inDriver": "A",
    "outDriver": "B",
    "inTime": "2026-05-06T10:00:00+09:00",
    "outTime": "2026-05-06T11:00:00+09:00",
    "garageInTime": null, //ガレージイン時刻。非null の場合は pitGap が null
    "pitGap": 3600, //DB保存なし。outTime - inTime（秒）をレスポンス生成時に計算。garageInTime が非null の場合は null
    "tire": true, //boolean
    "oil": false, //boolean
    "note": "メモ"
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
    "garageInTime": null,
    "pitGap": 3600,
    "tire": false,
    "oil": true,
    "note": ""
  },
  "3": {
    "managerId": 3,
    "manager": "あそう太郎",
    "pitNum": 3,
    "carNum": 6,
    "className": "st1",
    "teamName": "TeamA",
    "retire": false, //boolean
    "inDriver": "B",
    "outDriver": "A",
    "inTime": null, //garage-outパターン（ピットスタート）のため入時刻なし
    "outTime": "2026-05-06T16:00:00+09:00",
    "garageInTime": null,
    "pitGap": null, //inTime が null のため計算不可
    "tire": false,
    "oil": false,
    "note": ""
  }
}
```
