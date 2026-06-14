# TODO リスト（DB再設計に伴う積み残し）

2026-06-15 時点。`doc/database/dynamodb-design.md`（=正）と各 Lambda（入力/出力/検索）を
突き合わせて洗い出した、今後対応すべき項目。認証バグ修正・テーブル移行とは別枠の積み残し。

---

## C. コードが新設計に未追従（要コード修正）

設計書に定義はあるが、コードが旧仕様のままの箇所。

- [ ] **C-1 register.mjs に `admin: false` を追加**
  - `functions/auth/register.mjs` の PutItem に `admin: false` が無い。
  - 設計 §2 users「register 時に必ず false を書く」。outpost の認可で使用。

- [ ] **C-2 pit_log_history を「項目単位」記録に変更**（`functions/pitlog/updatePut.mjs`）
  - 現状: `action_type: "update"`（小文字）/ `field_name: "multiple"` に全項目を JSON 詰め。
  - 設計 §8: `action_type` は大文字 `"UPDATE"` / `"DELETE"`、**INSERT は記録しない**。
  - 設計 §8: 変更項目ごとに **1項目 = 1レコード**（field_name=項目名, old_value/new_value=単体値）。
    実際に変わった項目だけを書く。比較対象は in_time/out_time/garage_in_time/driver_out/tire/oil/note。
  - `field_name='multiple'` + JSON 方式は廃止。

- [ ] **C-3 time 検証（A/B/C の2-timeルール）を実装**（`autoCreate.mjs` / `handCreate.mjs` / `updatePut.mjs`）
  - 現状: 「inTime/outTime/garageInTime のいずれか1つ以上あれば可」「out_time 単独可」。
  - 設計 §7: 有効なのは必ず time 2つの以下3パターンのみ。それ以外（0個/1個/3個, out単独 等）はエラー。
    - A: in-out … in_time ✓ / out_time ✓ / garage_in_time null
    - B: in-garage … in_time ✓ / out_time null / garage_in_time ✓
    - C: garage-out … in_time null / out_time ✓ / garage_in_time ✓（out単独は不可）

- [ ] **C-4 retire upsert に `is_retired` を含める**（`functions/pitlog/updatePut.mjs` selection=2）
  - 現状: reason だけ UpdateItem → is_retired 欠落レコードができ得る。
  - 設計 §9 注意: upsert 時に is_retired を含めて担保する。

---

## D. 書き込み関数が存在しないテーブル（データ供給元が未実装）

読み取りはあるが、作成する Lambda が無い。管理者投入/シードの仕組みが別途必要。

- [ ] **D-1 pit_assignment の登録手段**（init.mjs が UsernameIndex で読むのみ）
  - 新SK `username#maintenance_area` を書く投入処理が必要。
- [ ] **D-2 start_driver の登録手段**（showAll.mjs が読むのみ）
- [ ] **D-3 race / entry の登録手段**（登録API無し。conform/init 等は存在前提）
- [ ] 管理者操作（`doc/IF/admin-operations.md`）の実装方針を確定する。

---

## E. スキーマ移行（テーブル定義の差分）

`dynamodb-design.md` に合わせるためのテーブル構造変更。custom-named のため CloudFormation は
その場置換ができず、対象テーブルは作り直しが必要（dev・データ破棄可）。

- [ ] **E-1 PitAssignment**: SK を `username` → `username#maintenance_area` に変更（要置換）。
- [ ] **E-2 OutpostLog**: GSI `UsernameIndex` に RANGE=`created_at` を追加（GSIキー変更＝その場不可）。
- [ ] **E-3 PitLog**: GSI `CarNumIndex` を削除（未使用・race非スコープ。その場削除可）。

> 補足: 現在どの関数も CarNumIndex / OutpostLog GSI / pit_log_history ModifiedByIndex を
> 検索に使っていない（定義のみ）。entry の vehicle_name / pit_garage、race の title も未使用。

---

## 参考: SQLcode.sql 側の追従（設計書より）

- [ ] pit_log.in_time の NOT NULL を撤廃（garage-out は in_time が null）。
- [ ] pit_log_history.action_type を UPDATE/DELETE 運用に合わせる（INSERT は使わない）。
