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
  - [チェックボックスのレイアウト](#チェックボックスのレイアウト)
  - [送信フロー](#送信フロー)

# 概要

リタイア登録画面（`html_Enter/enterRetire.html`）

レースに参加中の全車両を作業エリア順に表示し、リタイアした車両をチェックボックスで選択・リタイア理由を記入して送信する。

# インターフェース仕様

## API 1: GET /entries/retire — 初期データ取得

担当エリアによるフィルタなし。レースの全エントリー車両を作業エリア順で返す。既にリタイア済みの車両はその状態（`isRetired: true`）も合わせて返す。

### API パス

- `/entries/retire`

### メソッド

- `GET`

### リクエスト

#### クエリパラメータ

なし（ログイン中のユーザーはサーバのセッションから取得）

#### リクエストボディ

なし

### レスポンス

#### ステータスコード

- `200 OK`: 正常なレスポンス（`msg`: 空文字）
- `400 Bad Request`: パラメータエラー（`msg`: エラー詳細）
- `401 Unauthorized`: 未ログイン（セッション切れ含む）（`msg`: エラー詳細）
- `500 Internal Server Error`: サーバーエラー（`msg`: エラー詳細）

#### レスポンスボディ

```json
{
  "msg": "",
  "entries": [
    {
      "carNum": 5,
      "maintenanceArea": "1",
      "isRetired": false,
      "reason": ""
    },
    {
      "carNum": 3,
      "maintenanceArea": "2",
      "isRetired": true,
      "reason": "エンジンブロー"
    }
  ]
}
```

- `entries`: **EntryTable の `maintenance_area` 昇順**でソートされた配列。`maintenance_area` が同値の場合は `car_num` 昇順
- `carNum`: 車番（数値）
- `maintenanceArea`: 作業エリア（文字列。EntryTable の `maintenance_area`）
- `isRetired`: リタイア済みかどうか（boolean。RetireTable の `is_retired`）
- `reason`: リタイア理由（文字列。未リタイアは空文字）

取得元テーブル: EntryTable（全件）+ RetireTable（`car_num` でマージ）。RetireTable に該当レコードがない場合は `isRetired: false / reason: ""`

---

## API 2: POST /entries/retire — リタイア登録

詳細仕様は [enterRetire2.md](enterRetire2.md) を参照。

複数車両をチェックした場合は、選択車両数分のリクエストを順次送信する（1 リクエスト = 1 車両）。

---

## API 3: PUT /entries/update — リタイア情報更新 / 取り消し

既存 API を使用。詳細仕様は [enterUpdate2.md](enterUpdate2.md) を参照。

- **リタイア情報更新**（理由変更等）: `selection: "2"` / `carNum` / `reason` を送信
- **リタイア取り消し**: `selection: "3"` / `carNum` を送信

---

# 画面仕様

## チェックボックスのレイアウト

- GET /entries/retire の `entries` 配列の順序（作業エリア順）でチェックボックスを表示
- **10 台ごとに 1 列**として横に並べる

```
例）20台のエントリーの場合

[ ] 車番A  [ ] 車番K
[ ] 車番B  [ ] 車番L
[ ] 車番C  [ ] 車番M
[ ] 車番D  [ ] 車番N
[ ] 車番E  [ ] 車番O
[ ] 車番F  [ ] 車番P
[ ] 車番G  [ ] 車番Q
[ ] 車番H  [ ] 車番R
[ ] 車番I  [ ] 車番S
[ ] 車番J  [ ] 車番T
（1列目）   （2列目）
```

- 既にリタイア済みの車両（`isRetired: true`）はチェック済みかつ選択不可（disabled）で表示し、リタイア理由を車番横に添える
- 各チェックボックスのラベルには車番と作業エリアを表示（例: `#5 [エリア1]`）

## 送信フロー

```
1. ページ読み込み時に GET /entries/retire でエントリー一覧を取得
2. 作業エリア順・10台ごと列のチェックボックスを描画
3. ユーザーがリタイア車両を選択し、リタイア理由を入力
4. 送信ボタン押下
   - チェックされた車両数分、POST /entries/retire を順次送信
   - 全リクエスト完了後に成功メッセージを表示
   - いずれかのリクエストが失敗した場合はエラーメッセージを表示（失敗した車番を明示）
5. 送信成功後はチェックボックスを再描画（送信した車両を disabled 状態に更新）
```

バリデーション:

- チェックボックスが 1 つも選択されていない場合は送信不可（ボタン非活性 または アラート表示）
- リタイア理由が未入力の場合は送信不可
