# 03 race配下データ（entry / start_driver / pit_assignment）と race の削除

状態: **確定（2026-09-30）**

race に属する3つのテーブル（entry / start_driver / pit_assignment）の、管理者による登録・一覧・変更・削除と、race 自体を削除するときの扱いを定める。権限の共通ルールは [01_permission.md](01_permission.md)、race 自体の仕様は [02_race.md](02_race.md) に従う。

pitlog の参照・ダウンロードは04章で扱う。

## 1. 共通ルール

- **すべて管理者向け。** 一般利用者向けの参照・入力（`GET /entries/init` など）は既存のまま、対象外とする。
- **`raceId` は `X-Race-Id` ヘッダーで送る（01章 R10）。** URL（クエリ・パス）にもボディにも含めない。以下の各APIの説明・サンプルでは、`raceId` を明示的に書かない（すべてヘッダー経由）。
  - 一時 `title` を識別子にする案を検討したが、`title` は変更可能なため見送った。`raceId` は既に画面に表示していない（02章）ので、ヘッダー経由にすれば人の目にも触れない
- 操作の前に、必ずヘッダーの `raceId` から race を取得し、01章 §5.1 の手順に従う。
  1. race が存在しない、または他サーキット → **404**
  2. 書き込み系（登録・変更・削除）で、race が終了済み → **403**（`reason: "race_finished"`）
  3. 参照系（一覧取得）は、**終了済みでも許可する**（01章 R7 が pitlog の参照を終了後も認めているのと同じ考え方を、entry 等の確認にも広げる。§7 未決事項）
- CSVファイルによる一括も可
- 3テーブルとも `race_id`（PK）+ 各テーブルの SK で一意になる。`race_id` は 02章で決めた `raceId`（内部キー）をそのまま使う。

### 1.1 登録の理想フロー（entry / start_driver / pit_assignment 共通）

現行の `admin.js` は `regRaceId` という欄に `raceId` を手で入力させているが、これは廃止する。3テーブルとも、登録の流れは共通にする。

1. **レースを選ぶ。** 一覧（`GET /race`）の行をクリックして選択する。画面に `raceId` の入力欄は置かない。以後の操作は、選択したレースの `raceId` を毎回ヘッダーに乗せて送る。
2. **登録先テーブルを選ぶ。** entry / start_driver / pit_assignment をラジオボタンで選ぶ（現行のまま）。
   - **推奨する順序は entry → start_driver → pit_assignment。** start_driver は entry のドライバ枠を、pit_assignment は entry の作業エリアを検証で参照するため、entry が先に無いと弾かれる。
3. **入力方法を選ぶ。** 手入力（1件ずつフォームに貯める）／CSV（ファイルを選ぶと自動でプレビューへ進む）。PDFは今回は作らない（旧UIの「実装予定」表示は消す）。
4. **プレビューで確認する。** 貯まった行を表で一覧表示し、1行ずつ削除できる（現行の機能を踏襲）。
5. **登録する。** プレビューの内容を、対象のbulk APIへそのまま送る。
6. **結果を画面に反映する。** 成功したら件数を表示し、対象テーブルの一覧（`GET /entry` 等）を再取得して表示を更新する。失敗時はその場でエラーを表示する（トランザクション書き込みのため、一部だけ登録される状態にはならない）。

以下の各節では、この流れとは別に決めるべき「APIそのものの仕様」だけを書く。

## 2. entry

### 2.1 項目

| 項目（body）         | DB列                   | 型     | 必須 | 説明                                                     |
| -------------------- | ---------------------- | ------ | ---- | -------------------------------------------------------- |
| `carNum`             | `car_num`（SK）        | 数値   | ○    | 車番。同一 race 内で重複不可                             |
| `className`          | `class_name`           | 文字列 | ○    | クラス名                                                 |
| `entrantName`        | `entrant_name`         | 文字列 | ○    | エントラント名                                           |
| `vehicleName`        | `vehicle_name`         | 文字列 | ○    | 参加車両名                                               |
| `maintenanceArea`    | `maintenance_area`     | 数値   | ○    | Pit前作業エリア。車が使う場所は**1箇所だけ**なので数値（`5` など）。範囲を持つ pit_assignment（§4.1）とは型が異なる |
| `pitGarage`          | `pit_garage`           | 文字列 | ○    | ピットガレージ番号（`T1`のようにテントがあるため文字列） |
| `driverA`            | `driver_a`             | 文字列 | ○    | 代表ドライバ                                             |
| `driverB`〜`driverF` | `driver_b`〜`driver_f` | 文字列 | −    | 任意ドライバ。未登録は `null`                            |

- **廃止する列:** 現行の `bulkEntry.mjs` は `start_driver: null` という列を entry に持たせているが、実際のスタートドライバーは別テーブル `start_driver` で管理しており（`showAll.mjs` もそちらを参照する）、entry 側の `start_driver` はどこからも更新されない死んだ列になっている。新設時にこの列は持たない。

### 2.2 登録: `POST /entry/bulk`

画面のフローは §1.1 のとおり。既存の `bulkEntry.mjs` をベースに、次を直す。

- `requireAdmin` ＋ §1 の race 照合を追加する（今は無い）
- 車番の重複を、**リクエスト内**と**既存 entry との両方**で確認する（今は `BatchWriteCommand` がそのまま上書きしており、確認していない）
- `BatchWriteItem`（条件付き書き込み不可）を `TransactWriteItems`（`ConditionExpression: attribute_not_exists(car_num)` 付き）に置き換える。1トランザクション最大100件までだが、1レースのエントリー数は多くても数十件のため収まる
- §1 の手順で、終了済みのレースへの登録を拒否する

リクエスト（`raceId` はヘッダーへ移動。ボディからは削除）:

```json
{
  "entries": [
    {
      "carNum": 5,
      "className": "ST-1",
      "entrantName": "チームA",
      "vehicleName": "Honda NSX",
      "maintenanceArea": 1,
      "pitGarage": "5",
      "driverA": "あそう太郎",
      "driverB": null,
      "driverC": null,
      "driverD": null,
      "driverE": null,
      "driverF": null
    }
  ]
}
```

エラー:

| 条件                            | コード | msg                                    |
| ------------------------------- | ------ | -------------------------------------- |
| `entries` が空、必須項目の欠落  | 400    | 「未入力の項目があります」             |
| リクエスト内で `carNum` が重複  | 400    | 「ファイル内に重複する車番があります」 |
| 既存 entry と `carNum` が重複   | 409    | 「既に登録済みの車番が含まれています」 |
| race が存在しない／他サーキット | 404    | 01章 §6                                |
| race が終了済み                 | 403    | 「終了したレースです」                 |

管理者画面の「手入力」（1件ずつ画面に貯めて最後にまとめて送る）は、現行どおりこの1本のAPIに送る。単発登録用の別APIは作らない。

### 2.3 一覧: `GET /entry`

新設。`raceId` はヘッダー（`X-Race-Id`）で送る。`requireAdmin` ＋ race 照合（終了済みでも許可）。

```json
{
  "msg": "",
  "entries": [
    {
      "carNum": 5,
      "className": "ST-1",
      "entrantName": "チームA",
      "vehicleName": "Honda NSX",
      "maintenanceArea": 1,
      "pitGarage": "5",
      "driverA": "あそう太郎",
      "driverB": null,
      "driverC": null,
      "driverD": null,
      "driverE": null,
      "driverF": null
    }
  ]
}
```

0件のときは `entries: []`。

### 2.4 変更: `PUT /entry`

新設。`raceId`（ヘッダー）＋ `carNum`（ボディ）で対象を特定し、他の項目を更新する。`raceId` / `carNum` 自体は変更不可（車番を変えたい場合は削除＋新規登録）。

```json
{
  "carNum": 5,
  "className": "ST-2",
  "entrantName": "チームA",
  "vehicleName": "Honda NSX",
  "maintenanceArea": 2,
  "pitGarage": "6",
  "driverA": "あそう太郎",
  "driverB": null,
  "driverC": null,
  "driverD": null,
  "driverE": null,
  "driverF": null
}
```

| 条件             | コード | msg                                |
| ---------------- | ------ | ---------------------------------- |
| 対象が存在しない | 404    | 「対象のエントリーが存在しません」 |
| 必須項目の欠落   | 400    | 「未入力の項目があります」         |
| race が終了済み  | 403    | 「終了したレースです」             |

### 2.5 削除: `DELETE /entry/{carNum}`

新設。`raceId` はヘッダーで送る（`carNum` は車番であり秘匿する意味が無いためパスパラメータのまま）。**ピット記録（pit_log）が1件でも紐付く場合は削除不可（409）**（`pit_log` は PK `race_id` / SK `id`(ULID) のため、`race_id` で Query して `car_num` を `FilterExpression` で絞り込み、1件でもあれば拒否する）。削除に伴い、当該車両の `start_driver` / `pit_assignment` にも該当箇所があれば削除する（§5 で扱う）。

## 3. start_driver

### 3.1 項目

| 項目（body） | DB列            | 型     | 必須 | 説明                                                                            |
| ------------ | --------------- | ------ | ---- | ------------------------------------------------------------------------------- |
| `carNum`     | `car_num`（SK） | 数値   | ○    | 対象車両。当該 race の `entry` に存在すること                                   |
| `driver`     | `driver`        | 文字列 | ○    | `A`〜`F` の1文字。**当該車両の `entry` にある、非 null のドライバ枠であること** |

### 3.2 登録: `POST /entry/start-driver/bulk`

画面のフローは §1.1 のとおり。既存の `bulkStartDriver.mjs` をベースに、次を直す。

- `requireAdmin` ＋ race 照合を追加する（今は無い）
- `driver` が A〜F か、かつ entry に存在する（非null の）枠かを検証する（今は無い）。違反があれば **400**「そのドライバ枠はエントリーに登録されていません」
- リクエスト内の車番重複を確認する（同一車番は上書きとして許容し、確認だけ行う。§7 未決事項）

リクエスト:

```json
{
  "startDrivers": [{ "carNum": 5, "driver": "A" }]
}
```

エラー:

| 条件                                          | コード | msg                                                |
| --------------------------------------------- | ------ | -------------------------------------------------- |
| `startDrivers` が空                           | 400    | 「未入力の項目があります」                         |
| `driver` が A〜F 以外                         | 400    | 「ドライバ枠は A〜F で指定してください」           |
| 指定枠が当該車両の entry に存在しない（null） | 400    | 「そのドライバ枠はエントリーに登録されていません」 |
| 対象車両が entry に存在しない                 | 404    | 「対象の車両がエントリーに存在しません」           |
| race が存在しない／他サーキット               | 404    | 01章 §6                                            |
| race が終了済み                               | 403    | 「終了したレースです」                             |

### 3.3 一覧: `GET /entry/start-driver`

新設。`raceId` はヘッダーで送る。

```json
{
  "msg": "",
  "startDrivers": [{ "carNum": 5, "driver": "A" }]
}
```

### 3.4 変更: `PUT /entry/start-driver`

新設。`raceId`（ヘッダー）＋ `carNum`（ボディ）で特定し、`driver` を変更する。検証内容は登録と同じ。

```json
{ "carNum": 5, "driver": "B" }
```

エラー:

| 条件                        | コード | msg                                                |
| --------------------------- | ------ | -------------------------------------------------- |
| 対象が存在しない            | 404    | 「対象のスタートドライバーが存在しません」         |
| `driver` が A〜F 以外       | 400    | 「ドライバ枠は A〜F で指定してください」           |
| 指定枠が entry に存在しない | 400    | 「そのドライバ枠はエントリーに登録されていません」 |
| race が終了済み             | 403    | 「終了したレースです」                             |

### 3.5 削除: `DELETE /entry/start-driver/{carNum}`

新設。`raceId` はヘッダーで送る。

| 条件             | コード | msg                                        |
| ---------------- | ------ | ------------------------------------------ |
| 対象が存在しない | 404    | 「対象のスタートドライバーが存在しません」 |
| race が終了済み  | 403    | 「終了したレースです」                     |

## 4. pit_assignment

現状、API が全く無い（`admin.js` は `api: null` のまま）。新設する。

### 4.1 項目

| 項目（body）      | DB列                           | 型     | 必須 | 説明                                                                              |
| ----------------- | ------------------------------ | ------ | ---- | --------------------------------------------------------------------------------- |
| `username`        | `username`（SKの一部）         | 文字列 | ○    | 担当監視員。**登録済み利用者であること**                                          |
| `maintenanceArea` | `maintenance_area`（SKの一部） | 文字列 | ○    | 担当監視員の担当作業エリアの**範囲**。`"5-10"` のように開始と終了をハイフンで繋ぐ（1箇所だけなら `"7"`）。範囲を表すため文字列とする（entry 側は1箇所なので数値。§2.1 と型が異なる）。**展開した番号のいずれかが、当該 race の entry に存在すること** |

SK は `username#maintenance_area`。1人が複数エリアを担当する場合は、エリア数分のレコードになる。

### 4.2 検証で必要になる、今は無い仕組み

- **「`username` が登録済み利用者か」の確認。** `UsersTable` の PK は `cognito_sub` になっており、`username`（担当者名）で引く索引が無い。**`UsernameIndex`（HASH `username`）の新設が必要。**
- **「`maintenanceArea` が当該 race の entry に存在するか」の確認。** `entry` を `race_id` で Query し、`maintenance_area` の値と照合する。担当側は範囲（文字列）、entry 側は1箇所（数値）と型が違うが、既存の `init.mjs` にある `expandRange` は内部で `String()` を通してから解析するため、**どちらもそのまま渡せる**（数値 `5` は `[5]`、文字列 `"5-10"` は `[5,6,7,8,9,10]` に展開される）。展開後の番号が1つでも重なれば、そのエリアは存在すると判定する。

### 4.3 登録: `POST /pit-assignment/bulk`

画面のフローは §1.1 のとおり。`raceId` はヘッダーで送る。

```json
{
  "assignments": [{ "username": "あそう太郎", "maintenanceArea": "1-5" }]
}
```

| 条件                                             | コード | msg                                        |
| ------------------------------------------------ | ------ | ------------------------------------------ |
| `username` が登録済み利用者でない                | 400    | 「登録済みの監視員を指定してください」     |
| `maintenanceArea` が entry に存在しない          | 400    | 「存在しないピット場所です」               |
| リクエスト内で `username#maintenanceArea` が重複 | 400    | 「ファイル内に重複する担当割当があります」 |

### 4.4 一覧・変更・削除

`raceId` はいずれもヘッダー（`X-Race-Id`）で送る。`username` / `maintenanceArea` はトークンとして使う値ではないため、そのままクエリパラメータでよい。

- `GET /pit-assignment`
- `PUT /pit-assignment`（`oldUsername` / `oldMaintenanceArea` → `username` / `maintenanceArea`。SK が変わるため削除＋作成として扱う）
- `DELETE /pit-assignment?username=&maintenanceArea=`

旧設計書（[pitAssignment.md](../pitAssignment.md)）の形をほぼ踏襲する。認可だけ01章の方式に差し替える。

## 5. race の削除

02章 §5 で保留にしていた項目。

### 5.1 方針

**entry が1件でも残っていれば race を削除できない（409）。** 理由は次のとおり。

- 元の設計（旧 `race/delete.mjs`）もこの方針。安全側（誤操作で大量データを一括消去しない）。
- entry を消せば、紐づく `start_driver` / `pit_assignment` / `pit_log` も実質使われなくなる。

### 5.2 entry が残っている race を消したい場合

1件ずつ `DELETE /entry/{carNum}` で消してから、race を削除する。件数が多いと手間だが、**誤って race ごと一括消去する事故を防ぐため、あえて一括削除は用意しない**。

### 5.3 `entry` を削除したときの `start_driver` / `pit_assignment` の扱い

- **`start_driver`:** 対象車両の行を**同時に削除**する（車両が無いのにスタートドライバーだけ残る状態を避ける）。
- **`pit_assignment`:** 車両単位ではなく人単位のデータのため、**残置する**（監視員の担当は他の車両にも及ぶ可能性があるため）。race 自体を削除する際は、race に紐づく `pit_assignment` も合わせて削除する（race が無くなれば意味を持たないデータのため）。

## 6. 確定後に更新するもの

- [dynamodb-design.md](../../../database/dynamodb-design.md): `entry` から `start_driver` 列を削除。`UsersTable` に `UsernameIndex` を追加
- [template.yaml](../../../../backend-sam/template.yaml): `UsersTable` の索引追加。entry/start_driver/pit_assignment 用 Lambda の新設・権限
- `admin.js`: 一覧・変更・削除のUIを追加（今は登録のみ）

## 7. 未決事項

- **参照系（一覧取得）を終了済みの race にも許可する案（§1）。** 01章 R7 は pitlog の参照だけを対象にしていたので、これを entry 等の確認にも広げてよいか。
- **start_driver の重複時の扱い（§3.2）。** 上書きとして許容するか、entry と同様に拒否するか。
- **UI側のスコープ。** 一覧・変更・削除の画面は、レース一覧の行を選ぶと下に展開する形（旧設計書の構成）を想定しているが、実装する範囲は残り工数を見て判断する（01章 §9 と同じ考え方）。
