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

なし（**2026-10-04変更**）。

| 送るもの | 送り方 | 説明 |
| --- | --- | --- |
| `token` | `Authorization: Bearer <token>` ヘッダー | Cognito の ID トークン |
| `raceId` | **`X-Race-Id` ヘッダー** | conform が発行した署名付きトークン（[raceIdToken.md](raceIdToken.md)、01章 R10） |

※ 以前は `race_id` をクエリパラメータで送っていたが、トークン方式への一括移行で廃止した。
※ 認証以外の業務情報はクエリで送らず、リクエストボディで送る。

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
- `400 Bad Request`: パラメータエラー（`msg`: エラー詳細）。`inTime` / `outTime` がどちらも無い、出時刻が入時刻より前、**一度に101件以上**
- `401 Unauthorized`: 未ログイン（セッション切れ含む）（`msg`: エラー詳細）
- `403 Forbidden`: 担当エリア外の車両が含まれている／トークンが不正・終了済みのレース（`reason: "race_finished"`。01章 §5.4）
- `500 Internal Server Error`: サーバーエラー（`msg`: エラー詳細）。**書き込みが失敗した場合もここに入り、何も保存されていない**（下記「保存の仕方」）

### 保存の仕方（2026-10-09確定）

**`current` と `unsent` をマージした全件を、1回の `TransactWriteItems` で書き込む。** 全件成功か全件失敗のどちらかで、一部だけ入ることはない。

- 以前は `BatchWriteItem` を25件ずつ送り、**戻り値を見ていなかった。** `BatchWriteItem` は容量不足・スロットリング時に、処理できなかった項目を `UnprocessedItems` に入れた**正常応答**を返す（例外ではないので `try/catch` では捕まらない）。
- **この画面では取りこぼしが復旧できない。** フロントは送信が成功すると端末の未送信データ（`localStorage` の `unsentData`）を消すため、「200 が返ったのに入っていない」記録は端末にも残らない。
- 失敗時は **500** を返すので、画面は未送信データを保持したままやり直せる（`msg`: 「送信できませんでした。もう一度お試しください」）。
- トランザクションは1回 **100件まで**。マージ後の件数は車番ごとに1件なので担当エリアの台数分（多くて十数台）に収まるが、超えた場合は 400「一度に送信できるのは100件までです」で弾く（DynamoDB の読みにくい例外で500にしないため）。
- 管理者側の一括登録（[03_race_data.md §1.1](../aws-sam/admin/v2/03_race_data.md)）と同じ扱いに揃えた。

### レスポンスボディ

```json
{
  "msg": "エラー内容"
}
```
