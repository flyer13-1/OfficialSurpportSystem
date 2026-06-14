# DynamoDB テーブル設計書

`SQLcode.sql`（リレーショナル設計＝正）を DynamoDB に落とし込んだ設計。
SQL のテーブル名・項目名・項目順・型に揃えることを原則とし、DynamoDB の制約で
やむを得ず変える箇所のみ「備考」に理由を記す。

## 設計方針（前提となる決定事項）

- **AUTO_INCREMENT は使わない**（DynamoDB に連番機能が無いため）。代理キーは以下で代替する。
  - 自然キーがある → それをキーにする（users=`username`、pit_log=本来 (race_id,car_num,pit_num)）
  - 追記ログで自然順序キーが無い → **ULID**（時刻プレフィックス付き＝文字列ソートで時系列順になる）
- **ULID を使うテーブル**: `pit_log` / `pit_log_history` / `outpost_log`
  - ULID は `dynamodb.js` の `generateId()` が生成（固定幅 base32 の時刻 + ランダム）。
  - ULID は「保存順・一意キー・おおまかな時系列」用。**画面の「ピットイン順」など真の時系列は `in_time`（記録された実時刻）でソートする**（ULID は保存時刻であり実ピット時刻ではないため）。
- **race の識別子は2本立て**
  - `id`: 非秘密の識別子。レース登録（管理者・手動）時に一意な文字列を付与（例 `2026fuji_st`）。全 API の `race_id` はこれを使う。
  - `today_id`: **秘密（大会ID・パスワード相当）**。conform（`POST /user/me`）の照合でのみ使用。クエリパラメータ等に乗せない。
- 日時は ISO8601 文字列（`+09:00` 付き）で保持（SQL の DATETIME/TIMESTAMP 相当）。
- 整合性制約（UNIQUE / FK / CHECK）は DynamoDB では効かないため**アプリで担保**する。
- 課金は全テーブル `PAY_PER_REQUEST`。物理テーブル名は `OfficialSupportSystem-${Env}-<Name>`。

型表記: `S`=String / `N`=Number / `BOOL`=Boolean

---

## 1. organizations（所属サーキット）

- PK: `circuit`

| 属性 | 型 | キー | NULL | SQL対応 | 備考 |
|---|---|---|---|---|---|
| circuit | N | PK | NO | circuit | 1=富士 2=茂木 3=菅生 4=鈴鹿 5=岡山国際 6=その他 7=無所属 |
| name | S | | NO | name | 組織名（UNIQUE は登録時にアプリで担保）|

---

## 2. users（ログイン情報）

- PK: `username`（SQL の代理キー `id` は廃止し、UNIQUE だった username をキーにする）

| 属性 | 型 | キー | NULL | SQL対応 | 備考 |
|---|---|---|---|---|---|
| username | S | PK | NO | username | ひらがな・カタカナ・漢字 4〜20文字（アプリ検証）|
| password_hash | S | | NO | password_hash | bcrypt 60文字 |
| organization_id | N | | NO | organization_id | organizations.circuit を参照 |
| **admin** | BOOL | | NO | admin | **追加分**。既定 false。register 時に必ず false を書く。出力(outpost)の認可で使用 |
| created_at | S | | NO | created_at | ISO8601 |
| updated_at | S | | NO | updated_at | ISO8601 |

> 変更点: 現状 register.mjs は `admin` を書いていない → **`admin: false` を追加**する。

---

## 3. race（レースタイトル）

- PK: `id`

| 属性 | 型 | キー | NULL | SQL対応 | 備考 |
|---|---|---|---|---|---|
| id | S | PK | NO | id | **非秘密**の識別子。登録時に管理者が一意文字列を付与（AUTO_INCREMENT代替）|
| title | S | | NO | title | UNIQUE はアプリで担保 |
| today_id | S | | NO | today_id | **秘密（大会ID）**。半角英数15文字以上。conform でのみ照合。`race_id` には使わない |

> 変更点: conform.mjs は `race.id` を返す（現状通り）。`id` を String の手動採番にすることでこれが成立する。

---

## 4. entry（エントリー）

- PK: `race_id` / SK: `car_num`

| 属性 | 型 | キー | NULL | SQL対応 | 備考 |
|---|---|---|---|---|---|
| race_id | S | PK | NO | race_id | race.id |
| car_num | N | SK | NO | car_num | 車番 |
| class_name | S | | YES | class_name | クラス名 |
| entrant_name | S | | YES | entrant_name | エントラント名 |
| vehicle_name | S | | YES | vehicle_name | 参加車両名 |
| maintenance_area | S | | YES | maintenance_area | 作業エリア（"1〜45" または範囲文字列 "5-10"）|
| pit_garage | S | | YES | pit_garage | ピットガレージ割り当て |
| driver_a | S | | NO | driver_a | 代表ドライバ（必須）|
| driver_b〜driver_f | S | | YES | driver_b〜f | 最大6名。未登録は欠落（null）|

---

## 5. start_driver（スタートドライバー）

- PK: `race_id` / SK: `car_num`

| 属性 | 型 | キー | NULL | SQL対応 | 備考 |
|---|---|---|---|---|---|
| race_id | S | PK | NO | race_id | |
| car_num | N | SK | NO | car_num | |
| driver | S | | NO | driver | A〜F のいずれか |

---

## 6. pit_assignment（監視割り当て）

- PK: `race_id` / SK: `username#maintenance_area`
- GSI **UsernameIndex**: HASH=`username`, RANGE=`maintenance_area`

| 属性 | 型 | キー | NULL | SQL対応 | 備考 |
|---|---|---|---|---|---|
| race_id | S | PK | NO | race_id | |
| username#maintenance_area | S | SK | NO | —（合成）| (race_id,username,maintenance_area) の複合一意を表すための連結キー。DynamoDB の制約上やむを得ず追加 |
| username | S | GSI-PK | NO | username | 担当監視員 |
| maintenance_area | S | GSI-SK | NO | maintenance_area | 担当作業エリア |

> init.mjs は UsernameIndex を username で Query し race_id でフィルタしている（現状通り）。

---

## 7. pit_log（ピット監視記録）

- PK: `race_id` / SK: `id`（ULID）
- **GSI なし**（現状の `CarNumIndex` は race スコープ未対応かつ未使用のため削除）

| 属性 | 型 | キー | NULL | SQL対応 | 備考 |
|---|---|---|---|---|---|
| id | S | SK | NO | id | **ULID**（SQL の INT AUTO_INCREMENT 代替）|
| race_id | S | PK | NO | race_id | |
| car_num | N | | NO | car_num | |
| username | S | | NO | username | 記録担当者 |
| pit_num | N | | NO | pit_num | 何回目のピットイン。`max+1` で採番（アプリ）。pit_num=1→スタートドライバー |
| in_time | S | | YES | in_time | null 許容（下の time 検証ルール参照）|
| out_time | S | | YES | out_time | ガレージストップ時は2回目送信で UPDATE |
| garage_in_time | S | | YES | garage_in_time | ガレージイン時刻。非 null のとき pitGap=null |
| driver_out | S | | YES | driver_out | ピットアウト時ドライバ A〜F（CHAR(1)）|
| tire | BOOL | | NO | tire | 既定 false |
| oil | BOOL | | NO | oil | 既定 false |
| note | S | | YES | note | 備考 |
| created_at | S | | NO | created_at | ISO8601 |
| updated_at | S | | NO | updated_at | ISO8601 |

> 一意性 `(race_id, car_num, pit_num)` はキーではなく**アプリで担保**（1レース規模のため実害なし）。
> `pitGap`（out_time − in_time 秒）はレスポンス生成時に計算する派生値で **DB保存しない**。

### time 検証ルール（重要）

`in_time` / `out_time` / `garage_in_time` はスキーマ上すべて null 許容だが、**有効なのは以下の3パターン（必ず time 2つ）のみ**。それ以外（time が 0個 / 1個 / 3個、`out_time` 単独 等）は**入力ミスとしてエラー**にする。

| パターン | in_time | out_time | garage_in_time |
|---|---|---|---|
| A: in-out（通常）| ✓ | ✓ | null |
| B: in-garage（ガレージ作業）| ✓ | null | ✓ |
| C: garage-out（ピットスタート）| null | ✓ | ✓ |

- C は `out_time` 単独を許さず **`garage_in_time` を伴わせる**。`out_time` 単独だと入力ミス（in 押し忘れ）と区別できないため。
- `enterAuto2.md` の「out_time のみ」の例は本ルールで無効。IF設計書側も追従修正が必要。
- 派生: `garage_in_time` が非 null（B・C）のとき `pitGap` は null。

---

## 8. pit_log_history（ピット記録変更履歴）

- PK: `pit_log_id` / SK: `id`（ULID）
- GSI **ModifiedByIndex**: HASH=`modified_by`, RANGE=`modified_at`

| 属性 | 型 | キー | NULL | SQL対応 | 備考 |
|---|---|---|---|---|---|
| id | S | SK | NO | id | ULID |
| pit_log_id | S | PK | NO | pit_log_id | 対象 pit_log.id（ULID を参照）|
| action_type | S | | NO | action_type | UPDATE / DELETE（**大文字**。**INSERT は記録しない**＝新規作成は履歴対象外）。現状 "update" 小文字 → 要修正 |
| modified_by | S | GSI-PK | NO | modified_by | 操作者 |
| modified_at | S | GSI-SK | NO | modified_at | ISO8601 |
| field_name | S | | YES | field_name | 変更項目 |
| old_value | S | | YES | old_value | 変更前の値（その項目単体）|
| new_value | S | | YES | new_value | 変更後の値（その項目単体）|

### 履歴の記録方法（重要）

- **記録対象は変更（UPDATE）のみ。新規作成（INSERT）は残さない**（変更記録のため）。
- updatePut で**旧値（対象 pit_log）と新値を項目ごとに比較**し、**実際に変わった項目だけ**を **1項目 = 1レコード**で追記する（field_name にその項目名、old_value/new_value に前後の値）。
- 比較対象: `in_time` / `out_time` / `garage_in_time` / `driver_out` / `tire` / `oil` / `note`。
- 1回の編集で複数項目が変われば、複数レコードを書く（同一 pit_log_id・同一 modified_at、id(ULID) と field_name のみ異なる）。
- 何も変わっていなければ履歴は書かない。
- 現状の `field_name='multiple'` に全項目を JSON で詰める方式は**廃止**。

---

## 9. retire（リタイア記録）

- PK: `race_id` / SK: `car_num`

| 属性 | 型 | キー | NULL | SQL対応 | 備考 |
|---|---|---|---|---|---|
| race_id | S | PK | NO | race_id | |
| car_num | N | SK | NO | car_num | |
| is_retired | BOOL | | NO | is_retired | 既定 false。取り消しは false に UPDATE |
| reason | S | | YES | reason | リタイア理由 |

> 注意: updatePut の selection=2（reason 更新）は対象が無いと is_retired 欠落のまま作成され得る。upsert 時に is_retired を含めるようアプリで担保する。

---

## 10. outpost_log（出力画面アクセスログ）

- PK: `race_id` / SK: `id`（ULID）
- GSI **UsernameIndex**: HASH=`username`, RANGE=`created_at`（担当者別に時系列で引けるよう RANGE を追加）

| 属性 | 型 | キー | NULL | SQL対応 | 備考 |
|---|---|---|---|---|---|
| id | S | SK | NO | id | ULID |
| race_id | S | PK | NO | race_id | |
| username | S | GSI-PK | NO | username | アクセスした担当者（JWT から取得）|
| created_at | S | GSI-SK | NO | created_at | ISO8601 |

---

## 現行 template.yaml からの変更点まとめ

1. **pit_log**: `CarNumIndex` GSI を**削除**（race 非スコープ・未使用）。
2. **outpost_log**: `UsernameIndex` に RANGE=`created_at` を追加。
3. **users**: `admin` 属性を register 時に書き込む（テーブル定義変更は不要＝スキーマレス）。
4. **race**: `id` を「管理者が手動採番する非秘密 String」と明確化（型・キーは現状の S PK のまま）。
5. action_type は大文字（UPDATE/DELETE）に統一し、**INSERT は記録しない**。
6. pit_log_history は **項目単位（1項目=1レコード）** で差分のみ記録（field_name='multiple' 廃止）。
7. pit_log の time は **A/B/C の2-time パターン検証**を入れる（out_time 単独は不可）。

## SQLcode.sql 側にも追従が必要な点

- **pit_log.in_time の NOT NULL を撤廃**: garage-out（ピットスタート）は in_time が null のため、`in_time` を NULL 許容に直す。
- pit_log_history.action_type は INSERT を使わない運用に合わせる（コメントの想定値を UPDATE/DELETE に）。
