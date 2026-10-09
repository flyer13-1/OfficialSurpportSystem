# API 設計書

- [API 設計書](#api-設計書)
- [概要](#概要)
- [インターフェース仕様](#インターフェース仕様)
  - [API 1: GET /entries/retire — 初期データ取得](#api-1-get-entriesretire--初期データ取得)
    - [API パス](#api-パス)
    - [メソッド](#メソッド)
    - [リクエスト](#リクエスト)
      - [クエリパラメータ](#クエリパラメータ)
      - [リクエストボディ](#リクエストボディ)
    - [レスポンス](#レスポンス)
      - [ステータスコード](#ステータスコード)
      - [レスポンスボディ](#レスポンスボディ)
  - [API 2: POST /entries/retire — リタイア登録](#api-2-post-entriesretire--リタイア登録)
  - [API 3: PUT /entries/update — リタイア情報更新 / 取り消し](#api-3-put-entriesupdate--リタイア情報更新--取り消し)
- [画面仕様](#画面仕様)
  - [リタイア済みの一覧](#リタイア済みの一覧)
  - [送信フロー](#送信フロー)

# 概要

リタイア登録画面（`htmls/enterRetire.html`）

**車番とリタイア理由を入力して、1台ずつ登録する。** フォームの下に、**今リタイアしている車両を表で出す**（0台のときは「リタイアしている車両はいません。」と出す）。

> **2026-10-09変更:** 当初は「全車両を作業エリア順にチェックボックスで並べ、リタイアした車両を選ぶ」設計だったが、
> **実装は車番の手入力**になっており、一覧もチェックボックスも作られていなかった（`GET /entries/retire` も呼ばれていなかった）。
> リタイアは1台ずつ急いで登録する場面が多いため**入力は手打ちのまま**とし、
> 登録済みに気づけるよう**リタイア済みの一覧だけを足す**形に決めた。`GET /entries/retire` はその一覧に使う。

# インターフェース仕様

## API 1: GET /entries/retire — 初期データ取得

担当エリアによるフィルタなし。レースの全エントリー車両を作業エリア順で返す。既にリタイア済みの車両はその状態（`isRetired: true`）も合わせて返す。

### API パス

- `/entries/retire`

### メソッド

- `GET`

### リクエスト

#### クエリパラメータ

なし。`raceId` は **`X-Race-Id` ヘッダー**の署名付きトークンで送る（[raceIdToken.md](raceIdToken.md)、01章 R10）。利用者は認証トークン（`Authorization: Bearer`）から特定する。

#### リクエストボディ

なし

### レスポンス

#### ステータスコード

- `200 OK`: 正常なレスポンス（`msg`: 空文字）
- `400 Bad Request`: パラメータエラー（`msg`: エラー詳細）
- `401 Unauthorized`: 未ログイン（セッション切れ含む）（`msg`: エラー詳細）
- `403 Forbidden`: トークンが不正、または終了済みのレース（`reason: "race_finished"`。`requireGeneralRace`。01章 §5.4）
- `500 Internal Server Error`: サーバーエラー（`msg`: エラー詳細）

#### レスポンスボディ

```json
{
  "msg": "",
  "entries": [
    {
      "carNum": 5,
      "maintenanceArea": 1,
      "isRetired": false,
      "reason": ""
    },
    {
      "carNum": 3,
      "maintenanceArea": 2,
      "isRetired": true,
      "reason": "エンジンブロー"
    }
  ]
}
```

- `entries`: **EntryTable の `maintenance_area` 昇順**でソートされた配列。`maintenance_area` が同値の場合は `car_num` 昇順
- `carNum`: 車番（数値）
- `maintenanceArea`: 作業エリア（**数値**。EntryTable の `maintenance_area`。entry 側は車が使う場所が1箇所なので数値。03章§2.1）
- `isRetired`: リタイア済みかどうか（boolean。RetireTable の `is_retired`）
- `reason`: リタイア理由（文字列。未リタイアは空文字）

取得元テーブル: EntryTable（全件）+ RetireTable（`car_num` でマージ）。RetireTable に該当レコードがない場合は `isRetired: false / reason: ""`

**画面は `isRetired: true` の行だけを表に出す**（未リタイアの行は使わないが、APIは全件返したままにする。将来チェックボックス案に戻す場合や、他の画面で使う場合に備えて形を変えない）。

---

## API 2: POST /entries/retire — リタイア登録

詳細仕様は [enterRetire2.md](enterRetire2.md) を参照。

**1 リクエスト = 1 車両。** 画面は車番を1つ入力して送るため、1回の操作で1リクエストだけ送る。

---

## API 3: PUT /entries/update — リタイア情報更新 / 取り消し

既存 API を使用。詳細仕様は [enterUpdate2.md](enterUpdate2.md) を参照。

- **リタイア情報更新**（理由変更等）: `selection: "2"` / `carNum` / `reason` を送信
- **リタイア取り消し**: `selection: "3"` / `carNum` を送信

---

# 画面仕様

画面は上から **① 入力フォーム（車番・リタイア理由・送信）② リタイア済みの一覧** の順に置く。

## リタイア済みの一覧

- `GET /entries/retire` の `entries` のうち、**`isRetired: true` の行だけ**を表にする。
- 並び順はAPIが返したまま（**作業エリア昇順 → 車番昇順**）。画面で並べ替えない。
- 列は **車番 / 作業エリア / リタイア理由** の3つ。理由が空のときは `-` を出す。
- 見出しに**台数**を出す（例: 「リタイア済みの車両（2台）」）。
- **0台のときは表を隠し、「リタイアしている車両はいません。」**と出す。
- 一覧は登録の補助なので、**取得に失敗しても画面は使えるままにする**（表の代わりに「リタイア済みの一覧を取得できませんでした。」と出すだけで、入力フォームは触れる）。

この一覧があることで、**既に登録済みの車両を二重に登録して理由を上書きしてしまう**ことに気づける（`POST /entries/retire` は既にリタイア済みかを見ないため、同じ車番を送ると理由が上書きされる。[enterRetire2.md](enterRetire2.md)）。

## 送信フロー

```
1. ページ読み込み時に GET /entries/retire を呼び、リタイア済みの一覧を描画する
2. ユーザーが車番とリタイア理由を入力する
3. 送信ボタン押下 → POST /entries/retire（1台分）
4. 成功したら「送信完了」をトーストで出し、入力欄を空にする
5. 続けて GET /entries/retire を呼び直し、今登録した車両を一覧に反映する
```

バリデーション:

- 車番が未入力・0 の場合は送信しない（アラート表示）
- リタイア理由が未入力の場合は送信しない（アラート表示）
- 送信中は送信ボタンを無効にして二重送信を防ぐ
- 存在しない車番は、サーバーが **400**「指定された車両がエントリーに存在しません」で弾く（[enterRetire2.md](enterRetire2.md)）
