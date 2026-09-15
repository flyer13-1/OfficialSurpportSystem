# 管理者画面 IF — 担当割当（pit_assignment / E-05）

監視員が担当するピット場所（作業エリア）を確認・変更・削除する。対象テーブル: `pit_assignment`（PK `race_id` / SK `username#maintenance_area`、GSI `UsernameIndex`）。

- 共通仕様（認証・admin認可・キー命名・ステータスコード）は [index.md](index.md) を参照。
- すべて **認証必要 ＋ admin 限定**。
- 対象レースは **クエリパラメータ `race_id`** で指定する。
- **新規登録は3通り**：①手入力（1件）②Excel/CSV一括 ③PDF一括（[index.md](index.md) の「入力方法」参照）。個別の確認（R）・変更（U）・削除（D）も提供する。
- ②③のファイルはフロントで解析しJSON化して送る。**PDFは解析結果を画面で確認・修正してから送信**する。

## フィールド仕様

| フィールド（body） | DB列 | 必須 | 説明 |
|---|---|---|---|
| `username` | `username` | YES | 担当監視員。**登録済み利用者であること**（E-05-S1） |
| `maintenanceArea` | `maintenance_area` | YES | 担当作業エリア（"1"〜"45" 等）。**当該レースのエントリーに存在する作業エリアであること**（E-05-S2） |

- SK は `username#maintenance_area`（`#` 連結）。1監視員が複数エリアを担当する場合はエリア数分のレコードになる。
- `maintenance_area` を変える＝SKが変わるため、**変更（PUT）は「旧レコード削除＋新レコード作成」** として扱う（後述）。

---

## GET `/pit-assignment?race_id=` — 一覧取得

### リクエスト

- クエリパラメータ: `race_id`（必須）

### レスポンス（200）

```json
{
  "msg": "",
  "assignments": [
    { "username": "あそう太郎", "maintenanceArea": "1" }
  ]
}
```

- 0件のときは `assignments: []`。

---

## POST `/pit-assignment?race_id=` — 1件登録（手入力）

1件ずつフォーム入力で登録する。`username`（監視員）と `maintenanceArea`（作業エリア）を指定。

### リクエストボディ

```json
{
  "username": "あそう太郎",
  "maintenanceArea": "1"
}
```

### 振る舞い

- 対象レース（`race_id`）が存在することを確認。
- `username` が **登録済み利用者**であること（E-05-S1）、`maintenanceArea` が **当該レースのエントリーに存在する作業エリア**であること（E-05-S2）を検証。
- 保存（同一 `race_id` + `username#maintenance_area` は上書き）。レスポンス: `{ "msg": "" }`

### 準正常系

| 発生条件 | コード | msg 例 |
|---|---|---|
| 登録済み利用者でない監視員（E-05-S1） | 400 | 「登録済みの監視員を指定してください」 |
| エントリーに存在しない作業エリア（E-05-S2） | 400 | 「存在しないピット場所です」 |
| 対象レースが未登録 | 404 | 「対象のレースが登録されていません」 |

---

## POST `/pit-assignment/bulk?race_id=` — 一括登録（ファイルアップロード：Excel/PDF）

**Excel/CSV または PDF** をフロントで解析しJSON化して一括登録する。Excel と PDF で同一エンドポイント。PDF は解析結果を画面で確認・修正してから送信する。

### ファイルフォーマット（フロントが解釈する列）

| Excel 列 | → JSON キー | 必須 |
|---|---|---|
| 監視員 | `username` | YES |
| 作業エリア | `maintenanceArea` | YES |

- 1監視員が複数エリアを担当する場合は、エリア数分の行を並べる（SK `username#maintenance_area` 単位の行になる）。

### リクエストボディ（フロント→バックエンド）

```json
{
  "assignments": [
    { "username": "あそう太郎", "maintenanceArea": "1" },
    { "username": "あそう太郎", "maintenanceArea": "2" },
    { "username": "かんざきあおい", "maintenanceArea": "3" }
  ]
}
```

### 振る舞い

- 対象レース（`race_id`）が存在することを確認。
- 各レコードの `username` が **登録済み利用者**であること（E-05-S1）、`maintenanceArea` が **当該レースのエントリーに存在する作業エリア**であること（E-05-S2）を検証。
- ファイル内の **`username#maintenanceArea` 重複を検証**（重複があれば取り込みを中断し全体エラー）。
- 全件問題なければ一括保存（`BatchWriteItem` 等。同一 SK は上書き）。
- レスポンス: `{ "msg": "" }`

### 準正常系

| 発生条件 | コード | msg 例 |
|---|---|---|
| フォーマット不正（列不足・型不正等） | 400 | 「ファイルの形式が規定と異なります」 |
| ファイル内に重複（同一 監視員＋作業エリア） | 400 | 「ファイル内に重複する担当割当があります」 |
| 登録済み利用者でない監視員（E-05-S1） | 400 | 「登録済みの監視員を指定してください」 |
| エントリーに存在しない作業エリア（E-05-S2） | 400 | 「存在しないピット場所です」 |
| 対象レースが未登録 | 404 | 「対象のレースが登録されていません」 |

---

## PUT `/pit-assignment?race_id=` — 変更（1件）

担当割当を変更する。SK（`username#maintenance_area`）が変わるため、**旧キーを指定して新しい値に置き換える**。

### リクエストボディ

```json
{
  "oldUsername": "あそう太郎",
  "oldMaintenanceArea": "1",
  "username": "あそう太郎",
  "maintenanceArea": "2"
}
```

- `oldUsername` / `oldMaintenanceArea`: 変更対象の現在のキー。
- `username` / `maintenanceArea`: 変更後の値。

### 振る舞い

- 旧キー（`race_id` + `oldUsername#oldMaintenanceArea`）の行が存在しなければ 404。
- 変更後 `username` が **登録済み利用者**であることを検証（E-05-S1）。
- 変更後 `maintenanceArea` が **当該レースのエントリーに存在する作業エリア**であることを検証（E-05-S2）。
- 旧レコードを削除し、新レコードを作成（実装はトランザクション or 削除→作成）。新キーが既存と衝突する場合は 409。
- レスポンス: `{ "msg": "" }`

### 準正常系

| 発生条件 | コード | msg 例 |
|---|---|---|
| 指定した監視員が登録済み利用者でない（E-05-S1） | 400 | 「登録済みの監視員を指定してください」 |
| 指定エリアがエントリーに存在しない（E-05-S2） | 400 | 「存在しないピット場所です」 |
| 旧キーの対象が存在しない | 404 | 「対象の担当割当が存在しません」 |
| 変更後キーが既存と重複 | 409 | 「その担当割当は既に存在します」 |

---

## DELETE `/pit-assignment?race_id=&username=&maintenance_area=` — 削除

SK が複合キーのため、`username` と `maintenance_area` の両方を指定する。

### リクエスト

- クエリパラメータ: `race_id`（必須）/ `username`（必須）/ `maintenance_area`（必須）
- ボディ: なし

### 振る舞い

- 対象（`race_id` + `username#maintenance_area`）を削除。存在しなければ 404。
- レスポンス: `{ "msg": "" }`

### 準正常系

| 発生条件 | コード | msg 例 |
|---|---|---|
| 対象が存在しない | 404 | 「対象の担当割当が存在しません」 |
