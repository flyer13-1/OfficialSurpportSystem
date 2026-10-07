# 管理者画面 IF設計書（再構築版 v2）

管理者画面（admin.html）と、その背後の管理者APIの設計書。旧版（`../index.md` ほか）は未レビューで実装と大きく乖離していたため、白紙から作り直す。

- 本フォルダを正とする。旧版は、v2 の全章が確定したため**廃止済み**（2026-10-03、`index.md` / `race.md` / `entry.md` / `pitAssignment.md` / `startDriver.md` を削除。履歴は git に残る）。
- 1章ずつレビュー → 確定 → 次章の順で進める。フロントとバックエンドの両方が終わるまで次の機能に進まない（[nextJob.md](../../../../nextJob.md) の方針）。

## 実装方針: 管理者向けLambdaの置き場所（2026-10-03）

管理者向け（`requireAdmin` を通す）Lambdaは、対象のDBテーブルに関わらず **`functions/admin/`** に集約する。一般利用者向け（`functions/entry/` の `init.mjs` など）とは物理的に分ける。

- ファイル名は「対象＋操作」（例: `raceList.mjs` / `raceCreate.mjs` / `entryBulk.mjs` / `startDriverBulk.mjs`）。`functions/admin/` は1階層のフラットな構成になるため、`list.mjs` のような対象を含まない名前は、他テーブルの同名ハンドラと衝突するため使わない。
- 02・03・04章で新設する管理者向けAPI（race の CRUD、entry/start_driver/pit_assignment の一覧・変更・削除、pitlog の管理者向け参照）も、実装時はすべてこの規約で `functions/admin/` に追加する。
- 既存の `functions/race/*.mjs`（旧配置）と `functions/entry/bulkEntry.mjs` / `bulkStartDriver.mjs`（管理者向けのみ。`init.mjs` は一般向けのため対象外）は、`functions/admin/` に移動済み（`template.yaml` の `CodeUri`/`Handler` も追従済み）。

## 今後の予定: 設計書のフロント/バックエンド分割（未着手）

`doc/IF/` 配下の旧来のIF設計書（`enterAuto1.md` など）は、「API設計書」と銘打ちながら使用画面への言及が混在するなど、フロントとバックエンドの記述が1ファイルに同居している。最終的には次の形に分ける方針（2026-10-03決定）。

- **`doc/IF/`**: フロント専用に残す
- **`doc/aws-sam/`**: バックエンド専用（本フォルダ `admin/v2/` もここに含まれる）

本章(v2の01〜04章)はもともと「各章の中でフロントとバックエンドを合わせて定める」方針（冒頭参照）のため、章単位では分かれていない。今回、将来の分割に備えて各章の節ごとにフロント/バックエンドの仕分けだけを行った（各章冒頭の表を参照）。**実際にファイルを分割する作業はまだ行っていない。** まとまった時間が取れたタイミングで一気に行う予定。

## 章立てと状況

| 章 | ファイル | 内容 | 状況 |
|---|---|---|---|
| 01 | [01_permission.md](01_permission.md) | 権限モデル（認証・leader・サーキット・責務分担） | 確定（2026-09-28） |
| 02 | [02_race.md](02_race.md) | race（項目・登録・確認の表示・変更・終了後の表示。フロントとバックエンドを合わせて定める） | 確定（2026-09-30） |
| 03 | [03_race_data.md](03_race_data.md) | race に属するデータ（entry / start_driver / pit_assignment）の登録・確認・変更と、race の削除の扱い | 確定（2026-09-30） |
| 04 | [04_pitlog.md](04_pitlog.md) | pitlog の参照・ダウンロード（管理者画面・一般画面 共通） | 確定（2026-10-02） |

**全4章が確定。** 実装は01〜03章がフロント・バックエンドとも完了し、**残っているのは04章（pitlog）の管理者向け参照のみ**（2026-10-05時点）。詳しい残件は[下記](#実装の残件2026-10-05時点)。

章は、データ・API・画面の層ごとではなく、対象（race、race 配下のデータ、pitlog）ごとに区切る。各章の中で、フロントの表示とバックエンドの処理を一緒に決める。

## 実装の残件（2026-10-05時点）

nextJob.md の最後の節「結果を見るページ」に当たる部分。**着手順は 1 → 2。**

| # | 残件 | 内容 | 状況 |
|---|---|---|---|
| 1 | `showAllGimic.js` の共通部品化 | トップレベルの `getElementById` / `querySelector("tbody")`、グローバル `entries` の直読み、トップレベルの `addEventListener` を取り除き、`filterAndSortPitLogs(logs, {className, search})` と `renderPitLogTable(tbody, logs)` に引数で渡す形にする。イベントの紐付けは各画面（`showAll.js` / `outPosts.js` / 管理者ポップアップ）に移す（04章§4.1・§4.2） | 保留中（時間をかけて行う） |
| 2 | 管理者ポップアップ | `showAll.mjs` に leader 分岐（平文 raceId の受付・サーキット照合・終了済みでも許可）を追加し、admin.html にモーダル・表・CSV/PDFボタンを作る（04章§3.3・§4.2・§6） | 保留中（1の完了が前提） |

**04章§4.1 の6つの問題のうち、#4〜#6（`colSpan=12` の固定、`pitNum` 優先のソート、`managerId` の `NaN` 比較）は 2026-10-04 に解消済み。** 残りは #1〜#3（DOM決め打ちとグローバル変数）。

**別件で残っているもの**

- 入力画面（enter系）の送信失敗時の一時保存とその消去、送信成否の表示の土台。未設計。
- `backend-sam/local-server/server.mjs` が古く、**現状そのままでは動かない**（`functions/race/*.mjs` を import しているが、これらは `functions/admin/` に移動して存在しない。パスも旧 `/race`・`?race_id=` 方式で、`/admin/*` のルートも raceToken 対応も無い）。ローカル実行を再び使うなら全ルートの作り直しが必要。

## 確定事項ログ

| 日付 | 決定 | 内容 |
|---|---|---|
| 2026-10-05 | 03章§5: race 削除の実装 | `raceDelete.mjs` を§5準拠に書き換え。**`requireRace` によるサーキット照合を追加**（それまで `requireAdmin` だけで対象raceの `organization_id` を見ておらず、entry が0件なら他サーキットのレースも削除できた）。あわせて `X-Race-Id` ヘッダー方式に変更（`template.yaml` の Path を `/admin/race/{id}` → `/admin/race`、01章R10）、`pit_assignment` の後始末を追加（§5.3。`pit_assignment` → race の順に消す）。フロントの `adminRace.js` の削除ボタンも追従。IAM権限は既存の `RaceDataLambdaRole` で充足 |
| 2026-10-05 | 03章§3.6: start_driver の変更を一般利用者に開放 | **start_driver は一般利用者に変更を認める例外とする**（当初の「登録のみ、変更・削除は管理者限定」から変更）。枠を間違えて登録したときに担当者自身が直せないと、レース当日の進行に間に合わないため。変更できる範囲は登録と同じ（自分の担当エリア内の車両・entry にある非null の枠）で影響範囲は変わらない。**削除は認めない**（設定漏れ対策という本画面の目的と逆行するため）。実装は `PUT /entries/start-driver`（`functions/entry/startDriverUpdate.mjs`）として2026-10-04に完了済みで、今回設計書を追従させた |
| 2026-10-05 | 迷子 gitlink の整理 | バックエンドリポジトリの `html` は、最初の `awsのsam作成` コミット時にフロントのクローンが gitlink（mode 160000）として記録されただけのもの。`.gitmodules` が無くサブモジュールとして設定されておらず、中身も入っていない（ディスク上も空）。`git rm --cached html` でインデックスから削除した。**フロントは別リポジトリ `htmls` として管理する**（バックエンドリポジトリには含めない） |
| 2026-10-04 | 一般向けAPIの raceId トークン一括移行（完了） | 2026-10-03の時点で「後日一括移行」としていた [raceIdToken.md](../../../IF/raceIdToken.md) §8 を完了。**一般向けAPI（pitlog系7本・`init`・`POST`/`PUT /entries/start-driver`）がすべて `X-Race-Id` の署名付きトークン方式になり、`race_id` クエリパラメータは廃止。** 入口は共通処理 `raceToken.js` の `requireGeneralRace`（トークンの期限切れ＝終了済みとして403 `race_finished` を返すため、終了判定が別途不要になった）。フロント側も全画面が `X-Race-Id` でトークンを送る形に切り替え済み |
| 2026-10-04 | 04章: pitlog を設計準拠に（一般向けのみ） | `showAll.mjs` のデータ生成を共通レイヤー `pitLogs.js` の `buildPitLogs()` に切り出し、レスポンスを配列に変更、並び順を `inTime`（無ければ `outTime`）→ `carNum` の時刻順に修正、`OutpostLog` に `is_leader` を記録（§6）。`garageInTime` を全廃（既存データに値が無いことを確認済み。§2.5）。フロントは14列表示・`枠:氏名` 形式・出力を `.xls` → BOM付きCSV に変更（§4.3・§5）。**管理者向けの参照（ポップアップ・leader分岐）は未着手** |
| 2026-10-04 | 02章: `status` に `upcoming` を追加 | レース一覧の `status` を3値（`active`/`lastDay`/`finished`）から**4値**にし、開催初日より前を `upcoming`（開催前）として返す。開催前のレースが開催中と同じ見た目で区別できなかったため。開催初日は `finish_date` からの推定（土日開催が基本なので、終了日が日曜なら前日の土曜を初日とみなす。`raceStatus.js` の `startDayOf`）。**終了判定には影響しない**（`status` は表示用で、アクセス可否は従来どおり `finish_date` のみで決まる） |
| 2026-10-04 | `users`（担当者一覧）の提供元を変更 | pit_assignment の登録画面で使う担当者候補を、`GET /admin/race/data`（03章§1.2）から **`GET /admin/race`（02章§3）に移した**。担当者一覧はレースに依存しないデータなのに、`GET /admin/race/data` はレースを選んだ後でなければ呼べず、レース選択前に候補を出せなかったため |
| 2026-10-04 | authorizer の依存解決 | `authorizer` が `aws-jwt-verify` を読めず `AuthorizerConfigurationException` になっていたため、`functions/auth/package.json` を置いて依存を明示した |
| 2026-10-04 | フロント: admin画面の分割 | `admin.js` を `adminRace.js`（レース一覧・登録・変更・削除）/ `adminOther.js`（3テーブルの一括登録）/ `adminPreview.js`（プレビュー）/ `adminEdit.js`（一覧・変更・削除）に分割。サーキット一覧は `common.js` の `CIRCUIT_NAMES` に集約。`startDriver.html` / `startDriver.js` を新設し `main.html` から導線を張った（03章§3.6） |
| 2026-09-28 | サーキットの扱い | `6:その他` と `7:無所属` も 1〜5 と同格の独立した区分。各サーキットの leader は自分のサーキットの race だけ見える・触れる |
| 2026-09-28 | conform の入室 | 大会ID（`todayId`）での入室はサーキットで制限しない（他サーキットからの応援があるため） |
| 2026-09-28 | サーキットの取得元 | 管理者APIは毎回 Users テーブルを `sub` で引いて確認する（トークンには載せない） |
| 2026-09-28 | leader 失効の遅れ | leader を外してもトークン期限まで管理者扱いが残ることは許容する |
| 2026-09-28 | フロントの検証 | conform で `GET /user/me` の結果から `circuit` を sessionStorage に保存。admin 画面では `token` と `circuit` の有無だけ検証する |
| 2026-09-28 | 終了済みの race | `race.finish_date` を過ぎた race にはアクセスできない。ただし管理者は自分のサーキットの pitlog を参照・ダウンロードできる |
| 2026-09-28 | race の title | 重複の禁止はサーキットの中だけ（他サーキットとは重複してよい） |
| 2026-09-28 | users に登録が無い利用者 | 現行どおり 403 |
| 2026-09-28 | 不正・期限切れのトークン | 強制的にログイン画面へ戻す |
| 2026-09-28 | 終了の境界 | `finish_date` の翌日 0:00（JST）以降を終了済みとする |
| 2026-09-28 | 終了済みのコード | 新しいコードは作らず 403 を使い、`msg`（と `reason`）で区別する |
| 2026-09-28 | 403 の理由の判別 | body に `reason` を付ける（`not_admin` / `user_not_found` / `race_finished`）。conform の IF にも反映 |
| 2026-10-02 | ダウンロードの形式 | **CSV と PDF**（Excel/SpreadsheetML から変更。拡張子と中身の不一致による警告を避けるため。04章 §5） |
| 2026-10-02 | 列定義の一元化 | 画面に出す列の一覧をフロントに1つ置き（`PIT_LOG_COLUMNS`）、表の描画とCSV出力の両方がこれを使う。**ダウンロードの列＝表示している列**となり、ずれが起きない（04章 §4.3） |
| 2026-10-02 | raceId トークン | 署名付きトークン方式を**採用する方針で確定**。設計は [raceIdToken.md](../../../IF/raceIdToken.md) に作成（構造・発行・検証・鍵の管理・移行手順）。実装の着手時期は別途判断 |
| 2026-10-03 | raceIdToken.md 確定 | 未決事項を全て解消し**確定**。秘密鍵はSSM Parameter Store（手順は同書§6）。`raceId` の生成はULID（`generateId()`）に変更（02章§2.3を更新、トークンの署名が安全性の根拠になるため予測不可能性は不要）。プレリリース前のため移行は段階移行せず一括実装（同書§8） |
| 2026-10-03 | start_driver の一般利用者向け登録 | スタートドライバーの設定漏れ対策として、**一般利用者（担当者）向けの登録・参照**を追加（03章§3.6）。範囲は自分の担当エリアの車両のみ（`GET /entries/init` の既存の絞り込みをそのまま利用）。登録のみでき、変更・削除は管理者限定。新規フロント画面（仮称 `startDriver.html`）と新設API `POST /entries/start-driver` が必要 |
| 2026-10-03 | 02章バックエンド実装 | `functions/admin/raceCreate.mjs` / `raceList.mjs` / `raceUpdate.mjs` を02章準拠で実装（`RaceTable`に`OrganizationIndex`・`TodayIdIndex`を追加、`conform.mjs`もTodayIdIndexのQueryに変更）。終了判定・JST日付計算は共通レイヤー`raceStatus.js`に切り出し、`conform.mjs`と共用。フロント（admin.html/admin.js）は未着手 |
| 2026-10-03 | 03章: entry/start_driver/pit_assignment の一覧をAPI統合 | 個別に3本（`GET /admin/entry`・`GET /admin/start-driver`・`GET /admin/pit-assignment`）あった管理者向け一覧APIを**`GET /admin/race/data`1本に統合**（03章§1.2新設、§2.3・§3.3・§4.4は廃止）。理由: 01章§5.1のrace照合が1回で済む、start_driver/pit_assignmentの登録フォームがentryのデータを必要とするため画面側もどのみちまとめて持つ必要がある。登録・変更・削除はテーブルごとに個別のまま。対象Lambda: `functions/admin/showData.mjs`（新設） |
| 2026-10-03 | 管理者APIのURLパスを`/admin/<テーブル名>/...`に統一 | それまで`/race`・`/entry`・`/entry/start-driver`・`/pit-assignment`と散らばっていた管理者向けAPIのパスを`/admin/race`・`/admin/entry`・`/admin/start-driver`・`/admin/pit-assignment`に統一（`functions/admin/`というファイル配置と対応させる）。一般向けAPI（`/entries/...`）は変更なし。あわせて`start_driver`を`entry`のネストから独立させた（1テーブル1セグメントに揃えるため）。02・03章の該当箇所と`template.yaml`のPathを更新済み。フロント（`admin.js`）はまだ旧パスのまま未着手 |
| 2026-10-03 | 03章: entry・start_driver のバックエンド実装 | `entryBulk.mjs`/`startDriverBulk.mjs`を§2.2・§3.2準拠に書き換え、`entryUpdate.mjs`/`entryDelete.mjs`/`startDriverUpdate.mjs`/`startDriverDelete.mjs`（管理者向け）と`startDriverCreate.mjs`（一般向け、§3.6）を新設。`init.mjs`に`startDriver`を追加。共通処理を3つ切り出し: `raceAccess.js`(race照合)・`entryAccess.js`(driver枠検証)・`pitAssignmentAccess.js`(担当エリア算出)。一般向けAPIはraceIdトークン未移行のため、既存の`race_id`クエリパラメータ方式のまま（pitlog系7本・initとまとめて後日一括移行。[raceIdToken.md](../../../IF/raceIdToken.md) §8）。pit_assignment（§4）とフロントはまだ未着手 |
| 2026-10-03 | 03章: pit_assignment のバックエンド実装 | `pitAssignmentBulk.mjs`/`pitAssignmentUpdate.mjs`/`pitAssignmentDelete.mjs`を新設（§4.3・§4.4。以前はAPIが全く無かった）。`UsersTable`に`UsernameIndex`（HASH `username`）を追加し、「登録済み利用者か」の確認を実装（`usersAccess.js`）。「担当エリアがentryに存在するか」の確認は`pitAssignmentAccess.js`に追加（`getEntryAreaNumbers`/`overlapsEntryAreas`、bulk登録時にentryを1回だけ取得して使い回す）。変更はSKが変わるため削除＋作成のトランザクションとして実装。これで03章のバックエンド(entry/start_driver/pit_assignment)は全て実装済み。残りは§1.2（`GET /admin/race/data`）とフロント |
| 2026-10-03 | 03章: §1.2 統合一覧APIの実装 | `functions/admin/showData.mjs`を新設（`GET /admin/race/data`）。entry/start_driver/pit_assignmentを`race_id`でQueryし、usersは全サーキット分を`UsersTable`からScanして返す。requireAdmin+race照合（終了済みでも許可）は1回だけ。`RaceDataLambdaRole`に`UsersTable`のScan権限を追加。**これで03章のバックエンドは全て実装完了**。残るはフロント（`admin.js`・`admin.html`）のみ |
| 2026-10-02 | `pitNum` の改名 | **改名しない。** `pit_count` を検討したが7ファイル以上に及ぶため見送り。名前の紛らわしさ（`pit_num`＝回数 / `pit_garage`・`maintenance_area`＝場所）は設計書への明記で補う（04章 §8） |
| 2026-10-07 | レース変更画面の「表示と検索」 | 03章 §1.3 を追加。表示中の3表を横断して部分一致で絞り込む（フロントのみ・API追加なし）。複数語はAND、ひらがな・カタカナ・全角半角・大文字小文字は区別しない、検索語は保持しない。一致ゼロの扱いは「該当なし」で対象表を全部隠す |
| 2026-10-02 | 表示する列 | 14列（作業エリア・ゼッケン番号・担当者・リタイア・インドライバー・アウトドライバー・ピットイン・ピットアウト・ピットGAP・給油・タイヤ交換・クラス名・チーム名・備考） |
| 2026-10-02 | ドライバーの表示 | 枠と氏名を `X:NAME` 形式（例 `A:あそう太郎`）で1列にまとめる。画面・ダウンロード共通（04章 §4.3） |
| 2026-10-02 | PDF・エンドポイント名 | PDFは `window.print()` のまま。エンドポイントは `GET /entries/show` のまま変えない |
| 2026-10-02 | アクセス記録 | `OutpostLog` に leader かどうかも残す（04章 §6） |
| 2026-09-28 | ダウンロード | 記録は一般利用者・管理者を問わず、誰の操作でも残す |
| 2026-09-28 | `raceId` | 予測不可能な値にし、全サーキットを通して一意にする。一般向けAPIの `race_id` はこれを根拠に信用する（入室した race の記録は作らない） |
| 2026-09-28 | 一般向けAPIで race が無い | 404 |
| 2026-09-30 | maintenanceArea の型 | entry 側は車が使う場所が1箇所なので**数値**、pit_assignment 側は担当範囲（`"5-10"` の start-goal 形式）なので**文字列**。意味が違う別項目であり、型も揃えない。`expandRange` は内部で `String()` を通すため、両方そのまま扱える |
| 2026-09-30 | 登録フローの共通化 | entry / start_driver / pit_assignment の登録画面は共通のフロー（レース選択 → テーブル選択 → 入力方法 → プレビュー → 登録）にする。`raceId` の手入力欄は廃止（03章 §1.1） |
| 2026-09-30 | race の削除 | entry が1件でも残っていれば削除不可（409）。一括削除は用意しない（誤操作防止。03章 §5） |
| 2026-09-30 | raceId の送り方 | `raceId` は `token` と同じ扱いとし、メソッドに関わらず常に `X-Race-Id` ヘッダーで送る（01章 R10）。URLは既定でログに残りやすいがヘッダーは残りにくいため。02・03章のURL/ボディ記述をすべて更新 |
| 2026-09-29 | raceId のトークン化 | 署名付きトークンによる race アクセス制御を検討したが、対象ファイルが多く（backend約10本・frontend約7本、10〜14時間規模）、残り工数（約半月）に見合わないため見送り。R9（暗号論的乱数のraceId）を当面の実装として維持し、将来の拡張候補として01章 §9 に記録 |
| 2026-09-28 | 章立ての組み替え | データ・API・画面の層ごとではなく、対象ごと（02 race、03 race 配下のデータ、04 pitlog）に区切り、各章でフロントとバックエンドを一緒に決める |
| 2026-09-28 | 古い race の整理 | 今は考えない。削除やソートは、使われ方を見て将来の機能として検討する |
| 2026-09-28 | 管理者の pitlog 参照 | `showAll` の仕組みを流用し、画面は admin.html 内のポップアップ（新規）。ダウンロードボタンを増設する |

## 04章に引き継ぐこと

データ生成の共通化（`buildPitLogs()`）と一般向けの対応は2026-10-04に完了した。**残っているのは管理者向けの参照だけ**（上記「実装の残件」の 1・2）。

- 管理者向けの pitlog 参照は、**ハンドラを2本に分けず `GET /entries/show` 1本のまま**、呼び出し元が leader かどうかで分岐させる（04章§3.3の決定）。leader は平文の raceId を `X-Race-Id` で送る（管理者APIは raceId トークンの対象外。`raceToken.js` の冒頭コメント）。leader なら他サーキットは404・終了済みでも参照可、leader でなければ従来どおり終了済みは403
- ポップアップとダウンロードボタン（**CSV と PDF**。Excel から変更済み）で `showAllGimic.js` の表示処理を流用するため、`entries` などのグローバル名が `admin.js` 系と衝突しないようにする（これが残件1の中身）
- PDF は `window.print()` のままなので、ダイアログ以外を隠す印刷用CSSが別途必要になる
