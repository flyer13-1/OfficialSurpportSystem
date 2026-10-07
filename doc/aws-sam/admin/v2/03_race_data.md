# 03 race配下データ（entry / start_driver / pit_assignment）と race の削除

状態: **確定（2026-09-30）**

race に属する3つのテーブル（entry / start_driver / pit_assignment）の、管理者による登録・一覧・変更・削除と、race 自体を削除するときの扱いを定める。権限の共通ルールは [01_permission.md](01_permission.md)、race 自体の仕様は [02_race.md](02_race.md) に従う。

pitlog の参照・ダウンロードは04章で扱う。

> **フロント/バックエンド分割用の仕分け（2026-10-03、未実施・分類のみ）**
>
> | 節 | 分類 |
> |---|---|
> | 1. 共通ルール（1.1登録の理想フロー含む／1.2 統合一覧API） | 混在：1.1=フロントの操作フロー、1.2とそれ以外=バックエンド |
> | 2. entry（2.3は§1.2へ統合、2.1・2.2・2.4・2.5のみ） | バックエンド（画面は§1.1に集約済み） |
> | 3.1〜3.5 start_driver（管理者向け） | バックエンド |
> | 3.6 一般利用者向け: 登録・参照 | 混在（節内で画面とAPIがさらに混在） |
> | 4. pit_assignment（4.1〜4.4） | バックエンド |
> | 5. race の削除 | バックエンド |
> | 6. 確定後に更新するもの | バックエンド中心 |
> | 7. 未決事項 | バックエンド中心 |

## 1. 共通ルール

- **entry・pit_assignment は管理者向けのみ。** 一般利用者向けの参照・入力（`GET /entries/init` など）は既存のまま、対象外とする。
- **start_driver だけ、一般利用者向けの登録・参照・変更を追加する（2026-10-03、変更は2026-10-04に追加。§3.6）。** 削除は管理者限定。管理者向け（§3.1〜§3.5）は従来どおり。
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

1. **レースを選ぶ。** 一覧（`GET /admin/race`）の行をクリックして選択する。画面に `raceId` の入力欄は置かない。以後の操作は、選択したレースの `raceId` を毎回ヘッダーに乗せて送る。
2. **登録先テーブルを選ぶ。** entry / start_driver / pit_assignment をラジオボタンで選ぶ（現行のまま）。
   - **推奨する順序は entry → start_driver → pit_assignment。** start_driver は entry のドライバ枠を、pit_assignment は entry の作業エリアを検証で参照するため、entry が先に無いと弾かれる。
3. **入力方法を選ぶ。** 手入力（1件ずつフォームに貯める）／CSV（ファイルを選ぶと自動でプレビューへ進む）。PDFは今回は作らない（旧UIの「実装予定」表示は消す）。
4. **プレビューで確認する。** 貯まった行を表で一覧表示し、1行ずつ削除できる（現行の機能を踏襲）。
5. **登録する。** プレビューの内容を、対象のbulk APIへそのまま送る。
6. **結果を画面に反映する。** 成功したら件数を表示し、一覧（`GET /admin/race/data`。§1.2）を再取得して表示を更新する。失敗時はその場でエラーを表示する（トランザクション書き込みのため、一部だけ登録される状態にはならない）。

### 1.2 一覧: `GET /admin/race/data`（entry / start_driver / pit_assignment 共通、2026-10-03統合）

3テーブルとも1レースあたりの件数が少なく（多くて数十台分）、start_driver・pit_assignmentの登録フォームはentryのデータ（ドライバ枠・作業エリア）を参照する（§4.2）ため、個別に3本のAPIを持つより1本にまとめる。

- `requireAdmin` ＋ race 照合（01章§5.1）は**1回だけ**行う（個別APIのままだと一覧を開くたびに3回重複して行うことになる）。
- 参照系のため、終了済みの race でも許可する（§1 3.）。
- 対象Lambda: `functions/admin/showData.mjs`

**`users` は `GET /admin/race` に移した（2026-10-04）。** 当初はこの統合一覧（`GET /admin/race/data`）に含めていたが、担当者の一覧はレースに依存しないデータであり、`GET /admin/race/data` はレースを選んだ後でなければ呼べない。pit_assignment の登録画面はレース選択の前から担当者候補を出したいため、画面を開いた時点で必ず呼ぶ `GET /admin/race`（02章§3）の方に移した。

- **背景:** pit_assignment の登録画面で「誰を担当に割り当てるか」を選ぶには、`UsersTable` に登録済みの担当者名が分かる必要がある。`users.cognito:username` は Cognito のサインイン設定変更によりメールアドレスになっており担当者名としては使えない（[01_permission.md](01_permission.md) 用語「sub」の項）ため、`UsersTable.username`（DynamoDB側の値）を見るしかなく、それを閲覧する手段が無かった。
- **自分のサーキットに限らず、全サーキット分を返す。** 他サーキットからの応援でレースに参加する担当者がいるため（01章の conform と同じ考え方）。
- `organization_id` も併せて返す（画面側でどのサーキットの人か分かるように。表示用の対応表は `common.js` の `CIRCUIT_NAMES`）。
- 件数が少ない想定のため、新規GSIは作らず `UsersTable` をそのまま Scan する。

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
  ],
  "startDrivers": [{ "carNum": 5, "driver": "A" }],
  "pitAssignments": [{ "username": "あそう太郎", "maintenanceArea": "1-5" }]
}
```

0件のテーブルはそれぞれ `[]`。旧来の個別一覧API（`GET /admin/entry`・`GET /admin/start-driver`・`GET /admin/pit-assignment`）は廃止し、本APIに統合する（§2.3・§3.3・§4.4参照）。

以下の各節では、この流れとは別に決めるべき「APIそのものの仕様」だけを書く。

### 1.3 レース変更画面の「表示と検索」（フロントのみ・2026-10-07決定）

レース変更画面の entry / start_driver / pit_assignment の3表を、画面内で絞り込む。**API は追加しない**（§1.2 で取得済みのデータをそのまま使う）。

- **表示切替**: 3表それぞれにチェックボックスを置き、チェックを外すと表とそのカードを隠す。
- **対象の表**: 表示中（チェックON）の表だけ。非表示の表は検索されない。3表を**横断**して1つの検索欄で探す。
- **対象のセル**: 各行のセルのテキスト。ヘッダー（`thead`）と操作列（変更・削除ボタン）は除外する。
- **一致**: 部分一致。大文字小文字、全角・半角、**ひらがな・カタカナは区別しない**（「あそう」と「アソウ」は一致する）。
- **複数語**: 空白（半角・全角）で区切った語は、**すべてを含む行だけ**残す（AND）。
- **結果の表示**: 一致した行だけ残す。
  - 対象の表すべてで一致がゼロなら、対象の表を全部隠し、検索欄の下に「該当なし」を出す。
  - 一部の表だけ一致がゼロなら、その表のカードだけ隠す。
- **即時**: 入力のたびに絞り込む（Enter は不要）。
- **状態**: 検索語は保持しない。変更画面を開き直すと空に戻る。データを再読込したときは、入力中の検索語で絞り込みを掛け直す。

**注意**: 部分一致のため、数字の検索（例: 車番「3」）は「13」「30」にも一致する。仕様どおりの動作。

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

### 2.2 登録: `POST /admin/entry/bulk`

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

### 2.3 一覧（§1.2に統合）

**廃止。** entry 単体の一覧APIは作らない。`GET /admin/race/data`（§1.2）の `entries` を使う。

### 2.4 変更: `PUT /admin/entry`

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

### 2.5 削除: `DELETE /admin/entry/{carNum}`

新設。`raceId` はヘッダーで送る（`carNum` は車番であり秘匿する意味が無いためパスパラメータのまま）。**ピット記録（pit_log）が1件でも紐付く場合は削除不可（409）**（`pit_log` は PK `race_id` / SK `id`(ULID) のため、`race_id` で Query して `car_num` を `FilterExpression` で絞り込み、1件でもあれば拒否する）。削除に伴い、当該車両の `start_driver` / `pit_assignment` にも該当箇所があれば削除する（§5 で扱う）。

## 3. start_driver

§3.1〜§3.5 は管理者向け。**一般利用者（担当者）向けの登録・参照は §3.6 で別に定める**（2026-10-03追加。担当の車両にスタートドライバーを設定し忘れる運用上の問題が分かったため）。

### 3.1 項目

| 項目（body） | DB列            | 型     | 必須 | 説明                                                                            |
| ------------ | --------------- | ------ | ---- | ------------------------------------------------------------------------------- |
| `carNum`     | `car_num`（SK） | 数値   | ○    | 対象車両。当該 race の `entry` に存在すること                                   |
| `driver`     | `driver`        | 文字列 | ○    | `A`〜`F` の1文字。**当該車両の `entry` にある、非 null のドライバ枠であること** |

### 3.2 登録: `POST /admin/start-driver/bulk`

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

### 3.3 一覧（§1.2に統合）

**廃止。** start_driver 単体の一覧APIは作らない（管理者向け）。`GET /admin/race/data`（§1.2）の `startDrivers` を使う。一般利用者向けの参照は §3.6（`GET /entries/init` の拡張）で別に扱う。

### 3.4 変更: `PUT /admin/start-driver`

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

### 3.5 削除: `DELETE /admin/start-driver/{carNum}`

新設。`raceId` はヘッダーで送る。

| 条件             | コード | msg                                        |
| ---------------- | ------ | ------------------------------------------ |
| 対象が存在しない | 404    | 「対象のスタートドライバーが存在しません」 |
| race が終了済み  | 403    | 「終了したレースです」                     |

### 3.6 一般利用者向け: 登録・参照（2026-10-03追加）

**背景:** スタートドライバーの設定を管理者の一括登録だけに頼ると、設定漏れに現場で気付きにくい。担当者自身が、自分の担当車両について「もう決まっているか」を確認し、未設定ならその場で登録できるようにする。

**範囲:** `requireAdmin` は使わない。一般利用者向けAPI共通のルール（01章 §5.4。トークン＋`X-Race-Id`、終了済みなら403、サーキットでは制限しない）に従う。対象車両は、**呼び出し元の `pit_assignment`（担当エリア）に含まれる車両だけ**に絞る（`GET /entries/init` と同じ絞り込み。§4.2参照）。

**できること:** 登録と変更。**start_driver は、一般利用者に変更を認める例外とする**（2026-10-04変更。当初は「登録のみ」としていた）。

- **なぜ例外にするか:** 設定漏れ対策としてこの画面を用意した以上、枠を間違えて登録したときに担当者自身が直せないと、現場で「間違ったまま動かせない」状態が残る。管理者に伝えて直してもらう運用は、レース当日の数十分単位の進行には間に合わない。
- **変更できる範囲は登録と同じ**（自分の担当エリア内の車両、その車両の entry にある非 null の枠のみ）。他の担当エリアの車両には触れないため、影響範囲は登録を認めた時点と変わらない。
- **削除は認めない。** 管理者向けの §3.5 のみ。スタートドライバーが「未設定」に戻る操作は、設定漏れ対策という本画面の目的と逆行するため。
- entry / pit_assignment は従来どおり管理者向けのみで、この例外は start_driver に限る（§1）。

#### 画面

新規ページ（仮称 `startDriver.html`。他の一般画面と同様、画面遷移はconform通過後の利用者メニューに追加する）。

1. `GET /entries/init`（拡張後、下記）を呼び、担当エリア内の車両一覧を取得する。
2. 車両ごとに、その車両のドライバー枠（A〜F、非nullのもの）から1つ選べるフォームを出す。**登録済み**なら現在の枠を初期選択にしてボタンを「変更」にし、**未登録**ならボタンを「登録」にする（押したときに `PUT` と `POST` を使い分ける）。
3. 登録・変更すると、その車両の表示に反映する（一覧を再取得するか、画面側で即時反映する）。

#### `GET /entries/init` の拡張

既存のレスポンス（[enterAuto1.md](../../../IF/enterAuto1.md)）に `startDriver` を追加する。

```json
{
  "msg": "",
  "carNum": [5, 6, 15],
  "driver": {
    "5": ["A<br>あそう太郎", "B<br>かんざきあおい"],
    "6": ["A<br>かんじゃに"],
    "15": ["A<br>koko", "B<br>kesha"]
  },
  "startDriver": { "5": "A", "6": null, "15": null }
}
```

- `startDriver`: `carNum`（文字列キー）→ 登録済みのドライバー枠（`"A"`〜`"F"`）。未登録は `null`。
- `init.mjs` が絞り込んだ `carNum` と同じ車両だけを対象にする（担当エリア外の車両の登録状況は返さない）。

#### 登録: `POST /entries/start-driver`

```json
{ "carNum": 5, "driver": "A" }
```

処理の順序:

1. race を取得する。存在しない → 404。終了済みなら → 403（`reason: "race_finished"`）（01章 §5.4）
2. 対象車両が当該 race の `entry` に存在するか確認する。無ければ → 404「対象の車両がエントリーに存在しません」
3. **その車両が、呼び出し元の担当エリア（`pit_assignment`）に含まれるか確認する**（`init.mjs` と同じロジックで、都度サーバー側が算出する。クライアントが送ってきた前提を信用しない）。含まれなければ → 403「担当エリア外の車両です」
4. `driver` が A〜F か、かつ当該車両の entry で非null の枠かを確認する。違反があれば → 400「そのドライバ枠はエントリーに登録されていません」（§3.2と同じ検証）
5. 既に当該車両の `start_driver` が存在するか確認する（`ConditionExpression: attribute_not_exists(car_num)` 付きで書き込み、失敗したら重複とみなす）。重複なら → 409「スタートドライバーは既に登録されています」
6. 登録して `{ "msg": "" }` を返す

エラー:

| 条件                                           | コード | msg                                                  |
| ---------------------------------------------- | ------ | ----------------------------------------------------- |
| 対象車両が entry に存在しない                  | 404    | 「対象の車両がエントリーに存在しません」               |
| race が存在しない                              | 404    | 01章 §6                                               |
| 車両が担当エリア外                             | 403    | 「担当エリア外の車両です」                             |
| race が終了済み                                | 403    | 「終了したレースです」                                 |
| `driver` が A〜F 以外、または指定枠が null     | 400    | 「そのドライバ枠はエントリーに登録されていません」     |
| 既に登録済み                                   | 409    | 「スタートドライバーは既に登録されています」           |

- 単発登録のみ（bulkにしない）。管理者向けの `POST /admin/start-driver/bulk`（§3.2）とは別のLambda・別の認可にする（`requireAdmin` を使わないため、同じハンドラを流用しない）。
- 削除のAPIは一般向けには作らない（§3.5の管理者向けのみ）。

#### 変更: `PUT /entries/start-driver`（2026-10-04追加）

```json
{ "carNum": 5, "driver": "B" }
```

**登録（`POST`）と同じ範囲の検証を通し、違いは「既に登録されていること」を求める点。** 処理の順序:

1. race を取得する（`requireGeneralRace`）。トークンが不正 → 403、期限切れ＝終了済み → 403（`reason: "race_finished"`）
2. `driver` が A〜F の1文字か確認する。違えば → **400**「ドライバ枠は A〜F で指定してください」
3. **その車両が呼び出し元の担当エリアに含まれるか確認する**（`findUnassignedCars`）。含まれなければ → **403**「担当エリア外の車両です」
4. 当該車両の entry にその枠が非 null で存在するか確認する（`hasDriverSlot`）。無ければ → **400**「そのドライバ枠はエントリーに登録されていません」
5. `ConditionExpression: attribute_exists(car_num)` 付きで更新する。存在しなければ → **404**「スタートドライバーが未登録です」（登録は `POST` を使う）

| 条件                                        | コード | msg                                                |
| ------------------------------------------- | ------ | -------------------------------------------------- |
| `driver` が A〜F 以外                       | 400    | 「ドライバ枠は A〜F で指定してください」           |
| 指定枠が entry に無い（null を含む）        | 400    | 「そのドライバ枠はエントリーに登録されていません」 |
| 車両が担当エリア外                          | 403    | 「担当エリア外の車両です」                         |
| race が終了済み                             | 403    | 「終了したレースです」（`reason: "race_finished"`）|
| 未登録の車両に `PUT` した                   | 404    | 「スタートドライバーが未登録です」                 |

- **entry に無い車両は 404 ではなく 403「担当エリア外の車両です」になる**（担当エリアの判定が先に走るため）。`POST` は entry の存在を独立に確認して404を返すので、そこだけ挙動が違う。存在を伏せる方向のずれなので許容する。

- 対象Lambda: `functions/entry/startDriverUpdate.mjs`（管理者向けの `functions/admin/startDriverUpdate.mjs` とは別物。認可が違うため流用しない）。
- `POST` と `PUT` を分けるのは、「未登録のはずが実は登録済みだった」「登録済みのはずが消えていた」を画面が取り違えたまま上書きしないようにするため（単純な upsert にしない）。

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

### 4.3 登録: `POST /admin/pit-assignment/bulk`

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

### 4.4 変更・削除

一覧は**廃止**。`GET /admin/race/data`（§1.2）の `pitAssignments` を使う。

`raceId` はいずれもヘッダー（`X-Race-Id`）で送る。`username` / `maintenanceArea` はトークンとして使う値ではないため、そのままクエリパラメータでよい。

- `PUT /admin/pit-assignment`（`oldUsername` / `oldMaintenanceArea` → `username` / `maintenanceArea`。SK が変わるため削除＋作成として扱う）
- `DELETE /admin/pit-assignment?username=&maintenanceArea=`

旧設計書（`pitAssignment.md`。2026-10-03に廃止済み、履歴はgit参照）の形をほぼ踏襲する。認可だけ01章の方式に差し替える。

## 5. race の削除

02章 §5 で保留にしていた項目。

### 5.1 方針

**entry が1件でも残っていれば race を削除できない（409）。** 理由は次のとおり。

- 元の設計（旧 `race/delete.mjs`）もこの方針。安全側（誤操作で大量データを一括消去しない）。
- entry を消せば、紐づく `start_driver` / `pit_assignment` / `pit_log` も実質使われなくなる。

### 5.2 entry が残っている race を消したい場合

1件ずつ `DELETE /admin/entry/{carNum}` で消してから、race を削除する。件数が多いと手間だが、**誤って race ごと一括消去する事故を防ぐため、あえて一括削除は用意しない**。

### 5.3 `entry` を削除したときの `start_driver` / `pit_assignment` の扱い

- **`start_driver`:** 対象車両の行を**同時に削除**する（車両が無いのにスタートドライバーだけ残る状態を避ける）。
- **`pit_assignment`:** 車両単位ではなく人単位のデータのため、**残置する**（監視員の担当は他の車両にも及ぶ可能性があるため）。race 自体を削除する際は、race に紐づく `pit_assignment` も合わせて削除する（race が無くなれば意味を持たないデータのため）。

## 6. 確定後に更新するもの

**entry・start_driver（2026-10-03実装済み）**

- ~~[enterAuto1.md](../../../IF/enterAuto1.md): `GET /entries/init` のレスポンスに `startDriver` を追加（§3.6）~~ 実装済み
- ~~`init.mjs`: `startDriver` を返すよう拡張~~ 実装済み。担当エリア判定ロジックは `pitAssignmentAccess.js`（共通レイヤー）に切り出し、`startDriverCreate.mjs` と共用
- ~~entry/start_driver 用 Lambda の新設~~ 実装済み（`entryUpdate.mjs` / `entryDelete.mjs` / `startDriverUpdate.mjs` / `startDriverDelete.mjs` / `startDriverCreate.mjs`（一般向け、§3.6）を新設。`entryBulk.mjs` / `startDriverBulk.mjs` を §2.2・§3.2 準拠に書き換え）
- race照合（01章§5.1）の共通処理は `raceAccess.js`、driver枠検証は `entryAccess.js`（共通レイヤー）に切り出し、entry/start_driver系Lambda全体で共用

**pit_assignment（2026-10-03実装済み）**

- ~~[dynamodb-design.md](../../../database/dynamodb-design.md): `UsersTable` に `UsernameIndex` を追加~~ 実装済み
- ~~pit_assignment 用 Lambda の新設~~ 実装済み（`pitAssignmentBulk.mjs` / `pitAssignmentUpdate.mjs` / `pitAssignmentDelete.mjs` を新設。`username` の登録済み確認は `usersAccess.js`、担当エリアの存在確認は `pitAssignmentAccess.js`（共通レイヤー）に切り出し）

**§1.2（`GET /admin/race/data`、2026-10-03実装済み）**

- ~~[template.yaml](../../../../backend-sam/template.yaml): §1.2用に `GET /admin/race/data`（`functions/admin/showData.mjs`）を追加~~ 実装済み。`RaceDataLambdaRole`に`UsersTable`のScan権限を追加済み

**§5（race の削除、2026-10-05実装済み）**

- ~~`raceDelete.mjs` を §5 準拠に書き換える~~ 実装済み。`X-Race-Id` ヘッダー方式に変更（`template.yaml` の Path も `/admin/race/{id}` → `/admin/race`）、`requireRace` でサーキットを照合（それまで照合が無く、他サーキットのレースも消せた）、entry 紐付きで409、`pit_assignment` の後始末を追加（§5.3）
- 後始末は `pit_assignment` を消してから race を消す順にした。途中で失敗しても race が残ってやり直せるため（逆順だと到達できない `pit_assignment` が残る）

**フロント（2026-10-04実装済み）**

- ~~`admin.js`: entry/start_driver/pit_assignment の一覧・変更・削除のUIを追加（今は登録のみ）~~ 実装済み。`admin.js` は `adminRace.js`（レース一覧・登録・変更・削除）/ `adminOther.js`（3テーブルの一括登録）/ `adminPreview.js`（プレビュー）/ `adminEdit.js`（一覧・変更・削除）に分割した
- ~~新規ページ（仮称 `startDriver.html`）を追加し、利用者メニューから導線を作る~~ 実装済み（`startDriver.html` / `startDriver.js`、`main.html` にリンク。§3.6）

**これで03章はフロント・バックエンドとも実装済み。**

## 7. 未決事項

- **参照系（一覧取得）を終了済みの race にも許可する案（§1）。** 01章 R7 は pitlog の参照だけを対象にしていたので、これを entry 等の確認にも広げてよいか。
- **start_driver の重複時の扱い（§3.2）。** 上書きとして許容するか、entry と同様に拒否するか。
- **UI側のスコープ。** 一覧・変更・削除の画面は、レース一覧の行を選ぶと下に展開する形（旧設計書の構成）を想定しているが、実装する範囲は残り工数を見て判断する（01章 §9 と同じ考え方）。
