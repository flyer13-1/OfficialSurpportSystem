# 管理者操作・フロントエンド集計 設計書

API エンドポイントを持たず、AWS コンソール（IAMロール）またはフロントエンド側の計算で対応する業務をまとめる。

---

## 1. AWS 直接管理（管理者操作）

対象の業務 ID: **M-01 / E-01 / E-04 / E-05**

> **【更新】このセクションの方針は管理者画面に置き換えられた。**
> M-01 / E-01 / E-04 / E-05 は、AWSコンソール直接操作ではなく **管理者画面（API経由のCRUD）** で行う。
> 新しいIF設計は **[admin/v2/README.md](../aws-sam/admin/v2/README.md)** および配下の01〜04章を正とする（旧版の `admin/index.md` ほかは2026-10-03に廃止）。
> 以下の各テーブル定義・登録フィールドは、画面/APIが扱うデータ形状の参考として残す。
> （AWSコンソールでの直接操作は、画面が未整備な間の代替手段としてのみ利用する。）

レース開催前に管理者が AWS コンソールから DynamoDB を直接操作する。  
アクセスは IAM ロールで管理者のみに限定する。

---

### M-01 レースタイトル管理

操作対象テーブル: `RaceTable`

| 操作 | DynamoDB 操作 | 備考 |
|---|---|---|
| レース登録 | PutItem | 同名タイトル・同一大会IDの重複は手動で確認 |
| レース一覧参照 | Scan | |

登録するフィールド:

```json
{
  "id": "uuid-xxxx",       // PK。UUIDなど一意な値を手動で設定
  "title": "2026 Round 1", // レースタイトル。重複不可
  "todayId": "ABC123XYZ456789" // 大会ID。半角英数15文字以上・重複不可。U-06 の照合に使用
}
```

---

### E-01 エントリー1件登録

操作対象テーブル: `EntryTable`

| 操作 | DynamoDB 操作 | 備考 |
|---|---|---|
| エントリー登録 | PutItem | 同一 raceId + carNum の重複は手動で確認 |

通常は E-02（CSV一括登録 API）で登録する。1件手動登録はイレギュラー時のみ。

登録するフィールド:

```json
{
  "raceId": "uuid-xxxx",         // PK。対象レースの id
  "carNum": 5,                   // SK。車番（数値）。同一 raceId で重複不可
  "className": "ST-1",
  "entrantName": "チームA",
  "vehicleName": "Honda NSX",
  "maintenanceArea": "1",        // 作業エリア
  "pitGarage": 5,                // ピットガレージ番号
  "driverA": "あそう太郎",       // 代表ドライバ（必須）
  "driverB": "かんざきあおい",   // 任意
  "driverC": null,               // 任意（未登録は null）
  "driverD": null,
  "driverE": null,
  "driverF": null,
  "startDriver": null            // スタートドライバー。E-02 一括登録後に別途設定
}
```

---

### E-04 エントリー削除

操作対象テーブル: `EntryTable`

| 操作 | DynamoDB 操作 | 備考 |
|---|---|---|
| エントリー削除 | DeleteItem | PitLogTable に該当 carNum のレコードがないことを事前に確認すること |

削除キー: `raceId`（PK）＋ `carNum`（SK）

---

### E-05 監視員担当ピット登録

操作対象テーブル: `PitAssignmentTable`（task-list Phase 1 定義済み）

| 操作 | DynamoDB 操作 | 備考 |
|---|---|---|
| 担当登録 | PutItem | 監視員 1 名につき担当作業エリア 1 レコード |
| 担当変更 | PutItem（上書き） | |
| 担当参照 | Query（UsernameIndex） | |

登録するフィールド:

```json
{
  "race_id": "uuid-xxxx",                      // PK。対象レースの id
  "username#maintenance_area": "あそう太郎#1", // SK（複合キー）
  "maintenance_area": "1"                      // 担当作業エリア
}
```

- SK は `username` と `maintenance_area` を `#` で連結した複合キー
- 1 監視員が複数エリアを担当する場合はエリア数分のレコードを登録する
- `GET /entries/init`（enterAuto1.md）は UsernameIndex で `username` を検索し、担当エリアの車両のみを返す

---

## 2. フロントエンド集計（GET /entries/show のレスポンスを使用）

対象の業務 ID: **V-03 / V-04 / V-05**

`GET /entries/show`（showAll.md）が返す全ピット記録をフロントエンドで計算する。  
集計に必要な `tire` / `oil` / `garageInTime` は showAll.md のレスポンス修正により取得可能。

---

### V-03 指定時刻のドライバ参照

入力: 車番・参照時刻  
使用データ: 該当車番のピット記録（`inTime` / `outTime` / `garageInTime` / `outDriver`）＋ RetireTable

判定ロジック（フロントエンド実装）:

```
1. 該当車番のリタイア記録があり、リタイア時刻以降 → 「リタイア後」
2. 指定時刻が inTime〜outTime の間 → 「ピット内停車中」
3. outTime が null かつ garageInTime が非null → 「ガレージ内作業中」
4. outTime 以降、次の inTime まで → outDriver が運転中
5. 上記に当てはまらず inTime / outTime どちらかが欠落 → 「記録不備により判定不能」
6. 最初の出走（最初の outTime）より前 → 「未走行」
```

---

### V-04 チーム別ピット作業実績集計

入力: レース（全件取得済み）  
使用データ: 全ピット記録の `tire`（タイヤ交換）/ `outDriver`（ドライバ交代判定）

集計ロジック（フロントエンド実装）:

```
給油回数    : oil === true の件数（inTime・outTime ともに非null のものに限定）
ドライバ交代: 前回の outDriver と今回の outDriver が異なる件数
※ inTime または outTime が欠落しているレコードは除外し「記録不備あり」を表示
```

---

### V-05 ドライバ別ドライビング時間参照

入力: レース（全件取得済み）  
使用データ: 全ピット記録の `outDriver` / `outTime`（区間開始）/ 次レコードの `inTime`（区間終了）

集計ロジック（フロントエンド実装）:

```
走行区間 = 同一車両のピット記録の outTime から次のピット記録の inTime まで
区間の運転者 = その区間の outDriver
ピット作業中（inTime〜outTime）は集計対象外
次のピットインが未記録の区間は未確定として除外
in-garage（outTime が null）のレコードは出時刻確定後まで除外
※ 欠落区間は除外し「記録不備あり」を表示
```

---

## 3. 操作履歴（PitLogHistoryTable）

対象の業務 ID: **V-06**

`PitLogHistoryTable`（task-list Phase 1 定義済み）に履歴が蓄積される。  
フロントエンド向け API は現時点で未定義だが、テーブルは既に設計済みのため将来的に API 化可能。

| フィールド | 内容 |
|---|---|
| `pit_log_id` | PK。対象 PitLogTable のレコード id |
| `id`（ULID） | SK。履歴の一意 ID |
| `action_type` | `create` / `update` |
| `modified_by` | 操作者の username |
| `modified_at` | 操作日時 |
| `field_name` | 変更されたフィールド名 |
| `old_value` | 変更前の値 |
| `new_value` | 変更後の値 |

現状の参照手段: AWS コンソールから `PitLogHistoryTable` を直接 Query（`pit_log_id` 指定）または ModifiedByIndex で `modified_by` / `modified_at` を絞り込む。

---

## 補足：E-03 エントリー情報参照

レース中に運営者がエントリー一覧を確認する必要がある場合は、別途 `GET /entry`（API）の追加を検討する。  
AWSコンソールで代替できるなら API 不要。
