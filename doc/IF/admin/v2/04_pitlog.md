# 04 pitlog の参照・ダウンロード（管理者画面）

状態: **ドラフト（レビュー待ち）**

管理者が、自分のサーキットの race のピット記録（`pit_log`）を画面で確認し、Excel / PDF でダウンロードするための設計。権限の共通ルールは [01_permission.md](01_permission.md)、race の仕様は [02_race.md](02_race.md) に従う。

## 1. 位置づけ

- 一般利用者向けの `showAll.html`（確認）・`outPosts.html`（出力）は**既存のまま残す**。本章は `admin.html` の中に新しく作るポップアップの話。
- **終了済みの race でも、管理者は参照・ダウンロードできる**（01章 R7・§5.2）。一般利用者は終了済みだと 403。
- `raceId` はヘッダー（`X-Race-Id`）で送る（01章 R10）。

## 2. バックエンド

### 2.1 現状の整理（`showAll.mjs`）

今は1本の Lambda が全部やっている。

- `pit_log` / `entry` / `retire` / `start_driver` を並列に Query する
- `inDriver` を算出する（`pit_num=1` は `start_driver` の値、2以降は前回ピットの `driver_out`）
- `pitGap` を算出する（`garage_in_time` が null かつ in/out が揃っているときだけ）
- `act=1` なら `OutpostLog` に記録する

直すべき点は3つ。

| # | 現状 | 直す内容 |
|---|---|---|
| 1 | 認可が `username` の有無だけ。race の存在確認も終了判定もサーキット照合も無い | 一般向けは01章 §5.4、管理者向けは §5.1 の照合を通す |
| 2 | レスポンスが ULID をキーにしたオブジェクト。フロントは結局 `Object.keys()` で配列に戻している | 管理者向けは最初から配列で返す（§2.3） |
| 3 | 仮キーを書いてすぐ消す無意味なコードが残っている（`result[...] = null` → あとで `delete`） | 削除する |

### 2.2 共通化の方針

データを組み立てる部分を、Layer（`/opt/nodejs/`）の共通関数 `buildPitLogs(raceId)` に切り出し、**配列**を返す形にする。呼び出し側は2つ。

| 呼び出し元 | 前段の認可・照合 |
|---|---|
| `GET /entries/show`（一般向け・既存） | 01章 §5.4（race が無ければ404 / 終了済みなら403） |
| `GET /pit-log`（管理者向け・新規） | `requireAdmin` ＋ 01章 §5.1（他サーキットは404 / **終了済みでも許可**） |

### 2.3 API: `GET /pit-log`（管理者向け・新規）

`raceId` はヘッダーで送る。

```json
{
  "msg": "",
  "logs": [
    {
      "managerId": "01J8Z...",
      "manager": "あそう太郎",
      "pitNum": 1,
      "carNum": 5,
      "className": "ST-1",
      "teamName": "チームA",
      "retire": false,
      "inDriver": "A",
      "outDriver": "B",
      "inTime": "2026-08-30T13:05:00+09:00",
      "outTime": "2026-08-30T13:07:30+09:00",
      "garageInTime": null,
      "pitGap": 150,
      "tire": true,
      "oil": false,
      "note": ""
    }
  ]
}
```

| 項目 | 内容 |
|---|---|
| `managerId` | `pit_log.id`（ULID） |
| `manager` | 記録した担当者 |
| `pitNum` / `carNum` | ピット回数 / 車番 |
| `className` / `teamName` | `entry` から引く |
| `retire` | `retire` テーブルから引く |
| `inDriver` | `pitNum=1` は `start_driver`、2以降は前回の `outDriver` |
| `outDriver` | 出たときの運転者 |
| `inTime` / `outTime` / `garageInTime` | 時刻 |
| `pitGap` | ピット滞在秒数（ガレージ入りが無く、in/out が揃っているときだけ） |
| `tire` / `oil` / `note` | 作業内容・備考 |

- 0件のときは `logs: []`。
- 並び順は車番→ピット回数の昇順（現行の `showAll.mjs` と同じ）。

エラー:

| 条件 | コード | msg |
|---|---|---|
| race が存在しない／他サーキット | 404 | 01章 §6 |
| leader でない | 403 | 「管理者権限がありません」 |
| — | — | **終了済みでも 403 にしない**（参照系のため。01章 §5.1-3） |

### 2.4 一般向け `GET /entries/show` の扱い

- **レスポンス形式は変えない。** 現行の `showAll.js` / `outPosts.js` が ULID キーの形に依存しているため、変えるなら画面側2本も同時に直す必要がある（§7 未決事項）。
- 照合（404 / 403）の追加と、内部で `buildPitLogs` を使う形への置き換えだけ行う。

## 3. 画面（`admin.html` のポップアップ）

1. レース一覧の行にある「pitlog」ボタンを押すと、ポップアップが開く。
2. 開いた時点で `GET /pit-log` を呼ぶ（**このタイミングで `OutpostLog` に記録される**。§5）。
3. 取得した内容を表で一覧表示する。描画は `showAllGimic.js` の処理を流用する。
4. 「Excelで出力」「PDFで出力」のボタンを置く（§4）。
5. 「閉じる」でポップアップを閉じる。

**名前の衝突に注意。** `showAll.js` / `showAllGimic.js` は `entries` というグローバル変数を前提に書かれている。`admin.js` にそのまま持ち込むと衝突するため、流用する際は引数で受け渡す形に直すか、名前を分ける。

## 4. ダウンロード

`outPosts.js` の実装を流用する。

| 形式 | 方法 |
|---|---|
| Excel | SpreadsheetML（`.xls`）をクライアント側で組み立て、`Blob` でダウンロードさせる |
| PDF | `window.print()` を呼ぶ |

- ファイル名は `pit-log-<レースタイトル>-<YYYYMMDD>.xls` のように、どのレースのものか分かる名前にする（現行は日付だけ）。
- **列の範囲は要確認。** 現行の `outPosts.js` は12列だけ出しており、`garageInTime` / `tire` / `oil` を落としている。管理者向けは記録保全が目的のため、全項目を出す案（§7 未決事項）。

## 5. アクセス記録（`OutpostLog`）

01章の決定どおり、**誰の操作でも残す**。記録のタイミングは**データを取得したとき**（ポップアップを開いたとき）で、ダウンロードボタンを押したときではない。

| 項目 | 内容 |
|---|---|
| `race_id` | 対象レース |
| `username` | 操作した人 |
| `id` / `created_at` | ULID / 取得日時 |

現行の一般向け（`act=1`）と同じテーブル・同じ形で記録する。

## 6. 確定後に更新するもの

- `layers/common/nodejs/`: `buildPitLogs(raceId)` を新設（データ組み立ての共通化）
- [showAll.mjs](../../../../backend-sam/functions/pitlog/showAll.mjs): 共通関数の利用に置き換え、照合を追加、仮キーの無意味なコードを削除
- [template.yaml](../../../../backend-sam/template.yaml): `GET /pit-log` の Lambda を追加
- `admin.html` / `admin.js` / `admin.css`: ポップアップとボタン
- `showAllGimic.js`: グローバル変数の衝突を解消

## 7. 未決事項

- **一般向け `/entries/show` のレスポンス形式。** 管理者向けに合わせて配列に統一するか、現行のまま残すか（統一するなら `showAll.js` / `outPosts.js` の2本も直す必要がある）。
- **ダウンロードの列。** 全項目（16項目）にするか、現行の出力画面と同じ12列に合わせるか。
- **`OutpostLog` に管理者かどうかの区別を足すか。** 今は `username` だけで、管理者画面からの取得か一般画面からの取得かを区別できない。
- **PDF の出力方法。** `window.print()` のままでよいか（ポップアップの中身だけを印刷するには、CSS の調整が必要）。
