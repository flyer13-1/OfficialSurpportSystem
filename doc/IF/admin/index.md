# 管理者画面（一次情報CRUD）IF設計書 — 概要

レース運営者・管理者が、レース開催前の **一次情報** を登録・変更・削除するための管理者画面と、その背後のCRUD APIを定義する。

対象業務（[業務一覧.md](../../業務一覧.md)）:

| 業務ID             | 業務名                     | 対象テーブル     | エリア         |
| ------------------ | -------------------------- | ---------------- | -------------- |
| M-01               | レースタイトル管理         | `race`           | 上部（レース） |
| E-01 / E-03 / E-04 | エントリー登録／参照／削除 | `entry`          | 下部（詳細）   |
| （E-01 補助）      | スタートドライバー設定     | `start_driver`   | 下部（詳細）   |
| E-05               | 監視員担当ピット登録       | `pit_assignment` | 下部（詳細）   |

> **方針変更（重要）**: 従来 [admin-operations.md](../admin-operations.md) では M-01 / E-01 / E-04 / E-05 を「AWSコンソールから DynamoDB を直接操作」する運用としていた。本設計でこれを **管理者画面（API経由のCRUD）** に置き換える。CSV一括登録（`/entry/bulk` ほか）は別途（[about the path of api.md](../about%20the%20path%20of%20api.md)）。

---

## 1. 画面構成（1画面集約・遅延ロード）

`admin.html` 1枚に集約する。ページ遷移はしない。

### 上部: レース（`race`）

- **新規レース追加** フォーム（`raceId` / `title` を入力して登録）。
- `todayId`は自動で作成すること　titleに使われている文字を１つ以上利用、文字数を１５文字以上のもの、バリデーションの変更はない
- 既存レースの **一覧表示**。各行で **変更・削除** が可能。
- 各レース行を **クリックすると、その行の下（または下部パネル）に詳細エリアを展開** する。

### 下部: 選択レースの詳細（レース選択時に遅延ロード）

選択した1レースに属する一次情報を、以下3項目について **行ごとに確認・変更・削除** する。
これは今の順番で下に表示。

1. **エントリー（`entry`）** … 行ごとに変更・削除。新規登録は下記3通り（手入力／Excel／PDF）。
2. **スタートドライバー（`start_driver`）** … 行ごとに確認・変更・削除。新規登録は下記3通り（手入力／Excel／PDF）。
3. **担当割当（`pit_assignment`）** … 行ごとに確認・変更・削除。新規登録は下記3通り（手入力／Excel／PDF）。

> **新規登録（Create）は全テーブル共通で3通りの入力方法を想定**する：①手入力（1件フォーム）②Excel/CSVファイル ③PDFファイル。レース（`race`）も同様に①フォーム入力／②③ファイル一括取り込みを想定する。

### 入力方法（共通・3種）

| 方法 | 内容 | 送信先 |
|---|---|---|
| ① 手入力 | 1件ずつフォーム入力 | `POST /<resource>`（単件） |
| ② Excel/CSV | `.xlsx` / `.csv` をアップロード。フロントが SheetJS 等で解析しJSON配列化 | `POST /<resource>/bulk` |
| ③ PDF | PDFをアップロード。フロントが pdf.js 等でテキスト抽出しJSON配列化 | `POST /<resource>/bulk` |

- ②③とも **フロントで解析してJSON配列にしてから送る**（生ファイルはバックエンドに送らない）。`*/bulk` はファイル形式に依らず同じJSONを受け取る（Excel/PDFで別エンドポイントにしない）。
- **PDFの注意**: PDFはセル構造を持たないため表抽出が列ズレ・読み落としを起こしやすい（スキャンPDFはOCRが必要）。PDF取り込み時は **解析結果を画面プレビューで人が確認・修正してから登録**すること（誤りのまま登録しない）。確実性は Excel/CSV ＞ PDF。

### 処理負荷について（1画面でも重くならない）

- ページ初期表示時に呼ぶのは `GET /race`（一覧）のみ。
- 詳細3項目（entry / start_driver / pit_assignment）は **レースを選択した時に、その `race_id` 分だけ** 取得する（遅延ロード）。
- 全レースの詳細を一括取得しない。1レースあたりのデータ量も小さい（entry 最大数十件、start_driver / pit_assignment は数件）ため、1画面集約でもAPI呼び出し量・転送量は画面分割型と変わらない。

### レースの引き継ぎ

- 選択中レースの `raceId` を保持し（変数 / sessionStorage 等）、詳細3項目の各APIに **クエリパラメータ `race_id`** として送る（既存 `/entries/*` と同じ送信規約）。
- 管理者は複数レースを横断するため、`race_id` は JWT に埋め込まない（[[raceid-in-jwt-backend]] のJWT埋め込みは一般ユーザ用であり、管理者画面には適用しない）。

---

## 2. 認可（ログイン認証 ＋ admin 限定）

管理者APIは **「ログイン認証を通過した上で、admin ユーザであること」** を条件とする。2段構え。

1. **ログイン認証（JWT）**: `Authorization: Bearer <JWT>` を検証。無効・期限切れは **401**。
   - 大会ID認証（conform / `POST /user/me`）は **不要**。管理者は複数レースを横断するため特定レースへの入室を前提にしない。
2. **admin 認可**: 検証済みJWTから `username` を取得し、`UsersTable` で `admin === true` を確認。非adminは **403 Forbidden** を返しCRUDは行わない。

- フロントは認可を信用せず、token を送るのみ。403 を受けたら画面で弾く。
- 非adminによる試行は記録対象とする（出力画面と同方針 → [[admin-output-restriction]]）。

> `admin` は users テーブルに後付けした boolean 列（IF未記載の追加仕様）。register 時は必ず `false`。管理者は手動で `true` に設定する運用。

---

## 3. API一覧

| 区分               | メソッド | パス                                                   | 概要                      | C/R/U/D | 詳細                                 |
| ------------------ | -------- | ------------------------------------------------------ | ------------------------- | ------- | ------------------------------------ |
| レース             | GET      | `/race`                                                | レース一覧取得            | R       | [race.md](race.md)                   |
| レース             | POST     | `/race`                                                | レース登録 手入力（M-01） | C       | [race.md](race.md)                   |
| レース             | POST     | `/race/bulk`                                           | レース一括登録（Excel/PDF） | C     | [race.md](race.md)                   |
| レース             | PUT      | `/race`                                                | レース変更                | U       | [race.md](race.md)                   |
| レース             | DELETE   | `/race/{id}`                                           | レース削除                | D       | [race.md](race.md)                   |
| エントリー         | GET      | `/entry?race_id=`                                      | エントリー一覧（E-03）    | R       | [entry.md](entry.md)                 |
| エントリー         | POST     | `/entry?race_id=`                                      | エントリー1件登録 手入力（E-01） | C | [entry.md](entry.md)                 |
| エントリー         | POST     | `/entry/bulk?race_id=`                                 | エントリー一括登録（E-02・Excel/PDF） | C | [entry.md](entry.md)             |
| エントリー         | PUT      | `/entry?race_id=`                                      | エントリー変更            | U       | [entry.md](entry.md)                 |
| エントリー         | DELETE   | `/entry/{carNum}?race_id=`                             | エントリー削除（E-04）    | D       | [entry.md](entry.md)                 |
| スタートドライバー | GET      | `/entry/start-driver?race_id=`                         | 一覧取得                  | R       | [startDriver.md](startDriver.md)     |
| スタートドライバー | POST     | `/entry/start-driver?race_id=`                         | 1件登録 手入力            | C       | [startDriver.md](startDriver.md)     |
| スタートドライバー | POST     | `/entry/start-driver/bulk?race_id=`                    | 一括登録（Excel/PDF）     | C       | [startDriver.md](startDriver.md)     |
| スタートドライバー | PUT      | `/entry/start-driver?race_id=`                         | 変更                      | U       | [startDriver.md](startDriver.md)     |
| スタートドライバー | DELETE   | `/entry/start-driver/{carNum}?race_id=`                | 削除                      | D       | [startDriver.md](startDriver.md)     |
| 担当割当           | GET      | `/pit-assignment?race_id=`                             | 一覧取得                  | R       | [pitAssignment.md](pitAssignment.md) |
| 担当割当           | POST     | `/pit-assignment?race_id=`                             | 1件登録 手入力（E-05）    | C       | [pitAssignment.md](pitAssignment.md) |
| 担当割当           | POST     | `/pit-assignment/bulk?race_id=`                        | 一括登録（Excel/PDF）     | C       | [pitAssignment.md](pitAssignment.md) |
| 担当割当           | PUT      | `/pit-assignment?race_id=`                             | 変更                      | U       | [pitAssignment.md](pitAssignment.md) |
| 担当割当           | DELETE   | `/pit-assignment?race_id=&username=&maintenance_area=` | 削除                      | D       | [pitAssignment.md](pitAssignment.md) |

> 新規登録は全テーブル共通で **手入力（単件 `POST`）／ファイル一括（`*/bulk`、Excel・PDF）** を用意する。`*/bulk` はフロントが解析したJSONを受けるため、Excel と PDF で同一エンドポイント。

---

## 4. 共通仕様

### 認証

- すべて **認証必要**。`Authorization: Bearer <JWT>` を送り、admin 認可（§2）を通過すること。

### リクエスト／レスポンスのキー命名

- リクエスト／レスポンスボディは **camelCase**（`raceId` / `carNum` / `todayId` / `className` …）。
- DynamoDB 保存時に **snake_case**（`race_id` / `car_num` / `today_id` / `class_name` …）へ変換する。対応は [dynamodb-design.md](../../database/dynamodb-design.md) を正とする。

### 共通レスポンスボディ

特記なき限り、書き込み系（POST/PUT/DELETE）は以下を返す。

```json
{
  "msg": "エラー内容" // 正常時は空文字
}
```

### 共通ステータスコード

| コード                      | 意味                                              |
| --------------------------- | ------------------------------------------------- |
| `200 OK`                    | 正常（`msg`: 空文字。取得系はデータを併せて返す） |
| `400 Bad Request`           | パラメータ・バリデーションエラー（`msg`: 詳細）   |
| `401 Unauthorized`          | 未ログイン・トークン無効／期限切れ                |
| `403 Forbidden`             | admin でないユーザのアクセス                      |
| `404 Not Found`             | 対象（レース／エントリー等）が存在しない          |
| `409 Conflict`              | 重複登録、または関連データ紐付きにより削除不可    |
| `500 Internal Server Error` | サーバーエラー                                    |

> フロント `common.js` の `handleApiError` は現状 400/401/500 を扱う。403/404/409 を画面で扱うため、フロント実装時に分岐追加が必要（IF上はバックエンドが上記コードを返す）。
