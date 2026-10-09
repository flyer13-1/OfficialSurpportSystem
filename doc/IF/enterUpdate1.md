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
- `400 Bad Request`: `carNum` が未指定、または正の整数でない（`msg`: エラー詳細）
- `401 Unauthorized`: 未ログイン（セッション切れ含む）（`msg`: エラー詳細）
- `403 Forbidden`: 担当エリア外の車両／トークンが不正・終了済みのレース（`reason: "race_finished"`。01章 §5.4）
- `500 Internal Server Error`: サーバーエラー（`msg`: エラー詳細）

### レスポンスボディ

対象車両の全ピット記録を **`logs`（配列）** で返す。**2026-10-09変更**（それまでは
`pitNum` をキーにしたオブジェクトで、`inDriver` が常に `null`、`managerId`(ULID) を
返していた）。データの組み立ては共通処理 `buildPitLogs()`（[04_pitlog.md](../aws-sam/admin/v2/04_pitlog.md) §2.2）を
使い、対象車両の行だけを取り出す。項目は `GET /entries/show` と同じもの。

```json
{
  "msg": "",
  "reason": "エンジンブロー",
  "logs": [
    {
      "pitNum": 1,
      "carNum": 5,
      "manager": "あそう太郎",
      "retire": true,
      "inDriver": "A",
      "inDriverName": "あそう太郎",
      "outDriver": "B",
      "outDriverName": "きたのせいじ",
      "inTime": "2026-10-09T13:00:00.000Z",
      "outTime": "2026-10-09T13:02:00.000Z",
      "pitGap": 120,
      "className": "ST-1",
      "teamName": "チームA",
      "maintenanceArea": 3,
      "pitGarage": "5",
      "tire": true,
      "oil": false,
      "note": ""
    }
  ]
}
```

- `logs`: 対象車両のピット記録。**1台分なので時刻順＝ピット回数順**になる
- `reason`: **リタイア理由**（RetireTable）。車両ごとに1つなので `logs` の外に置く。リタイアしていなければ空文字。更新画面の「理由変更」の初期値に使う
- `inDriver` / `outDriver`: ドライバー枠（`A`〜`F`）。`inDriver` は**前回出ていった人**で、1回目だけ `start_driver` を使う（04章§2.3 のキュー方式）。`inDriverName` / `outDriverName` は entry から引いた氏名
- `pitGap`: `outTime - inTime`（秒）。**どちらかが欠けていれば `null`**（DB保存なし）
- `retire`: RetireTable の `is_retired`（boolean）
- **`garageInTime` は返さない。** 2026-10-04 に全廃した（04章§2.5）
- **`managerId` は返さない。** ULID で画面が使っておらず、`GET /entries/show` からも削除済み
