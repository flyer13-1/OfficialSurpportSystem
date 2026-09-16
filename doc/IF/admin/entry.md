# 管理者画面 IF — エントリー（entry / E-01・E-03・E-04）

レースに参加する車両・エントラント・ドライバ情報を登録・参照・変更・削除する。対象テーブル: `entry`（PK `race_id` / SK `car_num`）。

- 共通仕様（認証・admin認可・キー命名・ステータスコード）は [index.md](index.md) を参照。
- すべて **認証必要 ＋ admin 限定**。
- 対象レースは **クエリパラメータ `race_id`** で指定する（画面で選択中のレース）。

## フィールド仕様

| フィールド（body） | DB列 | 必須 | 説明 |
|---|---|---|---|
| `carNum` | `car_num` | YES | 車番（数値）。同一 `race_id` 内で **重複不可**（SK） |
| `className` | `class_name` | YES | クラス名 |
| `entrantName` | `entrant_name` | YES | エントラント名 |
| `vehicleName` | `vehicle_name` | YES | 参加車両名 |
| `maintenanceArea` | `maintenance_area` | YES | 作業エリア（"1"〜"45" または範囲文字列 "5-10"）。文字列 |
| `pitGarage` | `pit_garage` | YES | ピットガレージ割り当て。文字列 |
| `driverA` | `driver_a` | YES | 代表ドライバ（必須） |
| `driverB`〜`driverF` | `driver_b`〜`driver_f` | NO | 任意ドライバ（最大6名）。未登録は `null` |

> 必須項目は業務一覧 E-01 に準拠（車番・クラス名・エントラント名・参加車両名・作業エリア・ピットガレージ番号・代表ドライバA）。
> `car_num` / `race_id` は **キーのため変更不可**。車番を変えたい場合は削除＋新規登録。

---

## GET `/entry?race_id=` — エントリー一覧（E-03）

### リクエスト

- クエリパラメータ: `race_id`（必須）

### レスポンス（200）

```json
{
  "msg": "",
  "entries": [
    {
      "carNum": 5,
      "className": "ST-1",
      "entrantName": "チームA",
      "vehicleName": "Honda NSX",
      "maintenanceArea": "1",
      "pitGarage": "5",
      "driverA": "あそう太郎",
      "driverB": "かんざきあおい",
      "driverC": null,
      "driverD": null,
      "driverE": null,
      "driverF": null
    }
  ]
}
```

- 0件のときは `entries: []`（E-03-S1。「登録されたエントリーはありません」を画面で案内）。

---

## POST `/entry/bulk?race_id=` — エントリー一括登録（E-02・ファイルアップロード）

管理者が **Excel/CSV または PDF** をアップロードし、**フロントで解析して JSON 化**したものを一括登録する。Excel と PDF で同一エンドポイント。

### 解析の分担

- **フロント**:
  - Excel/CSV は SheetJS 等、PDF は pdf.js 等（テキスト抽出）で読み込み、ヘッダ行に従って各行を下記 JSON にマッピングする。
  - **PDF の場合は解析結果を画面プレビューで人が確認・修正してから送信**する（列ズレ・読み落とし対策。[index.md](index.md) の「入力方法」参照）。
  - 解析後の JSON 配列のみを送信（生ファイルはバックエンドに送らない）。
- **バックエンド**: 受け取った JSON 配列を検証し、まとめて保存する（ファイル形式は関知しない）。

### ファイルフォーマット（フロントが解釈する列）

1行目をヘッダとし、以下の列を持つ。フロントが列→フィールドへ対応付ける。

| Excel 列 | → JSON キー | 必須 |
|---|---|---|
| 車番 | `carNum` | YES |
| クラス名 | `className` | YES |
| エントラント名 | `entrantName` | YES |
| 参加車両名 | `vehicleName` | YES |
| 作業エリア | `maintenanceArea` | YES |
| ピットガレージ | `pitGarage` | YES |
| ドライバA | `driverA` | YES |
| ドライバB〜F | `driverB`〜`driverF` | NO |

### リクエストボディ（フロント→バックエンド）

```json
{
  "entries": [
    {
      "carNum": 5,
      "className": "ST-1",
      "entrantName": "チームA",
      "vehicleName": "Honda NSX",
      "maintenanceArea": "1",
      "pitGarage": "5",
      "driverA": "あそう太郎",
      "driverB": "かんざきあおい",
      "driverC": null, "driverD": null, "driverE": null, "driverF": null
    },
    {
      "carNum": 12,
      "className": "ST-2",
      "entrantName": "チームB",
      "vehicleName": "Toyota GR",
      "maintenanceArea": "3",
      "pitGarage": "12",
      "driverA": "かんざきあおい",
      "driverB": null, "driverC": null, "driverD": null, "driverE": null, "driverF": null
    }
  ]
}
```

### 振る舞い

- 対象レース（`race_id`）が存在することを確認。
- 各レコードの必須項目・形式を検証（E-02-S1: フォーマット不正なら**取り込まず**全体エラー）。
- ファイル内の **車番重複を検証**（E-02-S2: 重複があれば**取り込みを中断**し全体エラー。一部保存しない）。
- 既存エントリーとの車番重複も検証する（既存と衝突する車番があれば中断）。
- 全件問題なければ一括保存（`BatchWriteItem` 等）。結果は E-01 の手動登録と同等。
- レスポンス: `{ "msg": "" }`

### 準正常系

| 発生条件 | コード | msg 例 |
|---|---|---|
| フォーマット不正（列不足・型不正等／E-02-S1） | 400 | 「ファイルの形式が規定と異なります」 |
| ファイル内に車番重複（E-02-S2） | 400 | 「ファイル内に重複する車番があります」 |
| 既存エントリーと車番重複 | 409 | 「既に登録済みの車番が含まれています」 |
| 対象レースが未登録 | 404 | 「対象のレースが登録されていません」 |

---

## POST `/entry?race_id=` — エントリー1件登録（E-01・手入力）

1台ずつフォーム入力で登録する方法。ファイル一括（`/entry/bulk`）と並ぶ登録経路の1つ。

### リクエストボディ

```json
{
  "carNum": 5,
  "className": "ST-1",
  "entrantName": "チームA",
  "vehicleName": "Honda NSX",
  "maintenanceArea": "1",
  "pitGarage": "5",
  "driverA": "あそう太郎",
  "driverB": "かんざきあおい",
  "driverC": null,
  "driverD": null,
  "driverE": null,
  "driverF": null
}
```

### 振る舞い

- 対象レース（`race_id`）が存在することを確認（E-01-S3）。
- 必須項目を検証（E-01-S1）。
- 同一 `race_id` + `carNum` の重複を検証（PutItem の ConditionExpression `attribute_not_exists` / E-01-S2）。
- レスポンス: `{ "msg": "" }`

### 準正常系

| 発生条件 | コード | msg 例 |
|---|---|---|
| 必須未入力（E-01-S1） | 400 | 「未入力の項目があります」 |
| 同一車番が既に登録済み（E-01-S2） | 409 | 「その車番は既に登録されています」 |
| 対象レースが未登録（E-01-S3） | 404 | 「対象のレースが登録されていません」 |

---

## PUT `/entry?race_id=` — エントリー変更

`carNum` で対象を特定し、各フィールドを変更する。**`race_id` / `carNum`（キー）は変更不可**。

### リクエストボディ

```json
{
  "carNum": 5,
  "className": "ST-2",
  "entrantName": "チームA",
  "vehicleName": "Honda NSX",
  "maintenanceArea": "2",
  "pitGarage": "6",
  "driverA": "あそう太郎",
  "driverB": null,
  "driverC": null,
  "driverD": null,
  "driverE": null,
  "driverF": null
}
```

### 振る舞い

- 対象 `race_id` + `carNum` が存在しなければ 404。
- 必須項目（`className`〜`driverA`）を検証。任意ドライバは `null` で消去可。
- レスポンス: `{ "msg": "" }`

### 準正常系

| 発生条件 | コード | msg 例 |
|---|---|---|
| 対象が存在しない | 404 | 「対象のエントリーが存在しません」 |
| 必須未入力 | 400 | 「未入力の項目があります」 |

---

## DELETE `/entry/{carNum}?race_id=` — エントリー削除（E-04）

### リクエスト

- パスパラメータ: `carNum`（数値）
- クエリパラメータ: `race_id`（必須）

### 振る舞い（関連データの保護）

- 対象 `race_id` + `carNum` に **ピット記録（`pit_log`）が紐付く場合は削除不可（409 / E-04-S1）**。
- 対象が存在しなければ 404（E-04-S2）。
- 削除に伴い、当該車両の `start_driver` / `pit_assignment` の扱いはアプリで整合をとる（残置を許さないなら同時削除を検討。実装方針は別途）。
- レスポンス: `{ "msg": "" }`

### 準正常系

| 発生条件 | コード | msg 例 |
|---|---|---|
| ピット記録が紐付いている（E-04-S1） | 409 | 「ピット記録が紐付いているため削除できません」 |
| 対象が存在しない（E-04-S2） | 404 | 「対象のエントリーが存在しません」 |
