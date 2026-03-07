# OfficialSupportSystem

モータースポーツのレースにおけるピット作業を監視・管理するための公式サポートシステム。エントリーリストの登録、ピットイン/アウトの記録、ドライバー交代・給油・タイヤ交換の追跡を行う。

## アーキテクチャ

本システムは **Webサーバ** と **APIサーバ** の2層構成で動作する。

```
[クライアント (ブラウザ)]
        |
    (Port 8080)
        |
[Web サーバ (server--web)]  ──HTTP──>  [API サーバ (sever--api)]
                                              |
                                         (Port 9000)
                                              |
                                          [MySQL]
```

### server--web（Webサーバ / Port 8080）

- クライアントへのHTML配信およびルーティングを担当
- IPアドレスによるアクセス制御
- 受け取ったリクエストをAPIサーバへ転送するプロキシ的役割
- ルート: `/login`, `/enter`, `/show`, `/delete`

### sever--api（APIサーバ / Port 9000）

- ビジネスロジックとデータベース操作を担当
- CORSおよびOriginヘッダによるアクセス制御（Webサーバからのみ許可）
- MySQL接続によるデータの永続化

### other-loginApp（ログインアプリ）

- 認証機能（サインイン・アカウント登録）の別実装
- Nginx 1.29.1 によるリバースプロキシ構成
- パスワード強度のリアルタイムバリデーション（8文字以上、大文字・小文字・数字必須）

## 技術スタック

| カテゴリ | 技術 |
|---------|------|
| ランタイム | Node.js |
| フレームワーク | Express 5 |
| データベース | MySQL |
| リバースプロキシ | Nginx 1.29.1 |
| 開発ツール | nodemon |

## データベース設計

### テーブル一覧

| テーブル名 | 説明 |
|-----------|------|
| `race` | レース情報（タイトル） |
| `organizations` | ユーザ所属組織 |
| `users` | ユーザアカウント（ログインID、ハッシュ化パスワード、ニックネーム、所属） |
| `entry` | エントリーリスト（カーナンバー、ピット番号、ドライバーA〜F） |
| `pit_log` | ピット監視記録（イン/アウト時刻、ドライバー交代、給油、タイヤ交換、備考） |

### ER関係

```
race (1) ──< entry (N)
race (1) ──< pit_log (N)
entry (1) ──< pit_log (N)  [car_num]
organizations (1) ──< users (N)
```

## ディレクトリ構成

```
OfficialSurpportSystem/
├── server--web/            # Webサーバ
│   ├── webserver.js        # メインサーバ（Port 8080）
│   ├── routes/
│   │   └── enter.js        # エントリー登録ルート
│   └── package.json
├── sever--api/             # APIサーバ
│   ├── apiServer.js        # メインサーバ（Port 9000）
│   └── package.json
├── other-loginApp/         # ログイン機能（別実装）
│   ├── nginx-1.29.1/       # Nginx設定・関連ファイル
│   │   └── conf/nginx.conf
│   └── node.js/            # Node.jsログインアプリ
│       ├── server.js
│       ├── routes/auth.js
│       └── public/         # 静的ファイル（HTML/CSS/JS）
├── SQLbase                 # MySQL基本コマンドメモ
└── SQLcode.txt             # テーブル定義SQL（実行テスト済み）
```

## セットアップ

### 前提条件

- Node.js
- MySQL
- Nginx（ログインアプリを使用する場合）

### 1. データベースの準備

MySQLにログインし、`SQLcode.txt` に記載されたSQLを実行してテーブルを作成する。

```bash
mysql -u root -p
```

テーブルの作成順序（外部キー制約のため）:
1. `race`
2. `organizations`
3. `users`
4. `entry`
5. `pit_log`

### 2. Webサーバの起動

```bash
cd server--web
npm install
npm start
```

Webサーバが `http://localhost:8080` で起動する。

### 3. APIサーバの起動

```bash
cd sever--api
npm install
npm start
```

APIサーバが `http://localhost:9000` で起動する。

### 4. ログインアプリの起動（任意）

```bash
cd other-loginApp/node.js
npm install
node server.js
```

## エントリーデータのCSV一括登録

`entry` テーブルにCSVファイルからデータを一括登録できる。

```sql
LOAD DATA INFILE '/path/to/entry.csv'
INTO TABLE entry
FIELDS TERMINATED BY ','
ENCLOSED BY '"'
LINES TERMINATED BY '\n'
IGNORE 1 LINES
(car_num, pit_num, driver_A, driver_B, driver_C, driver_D, driver_E, driver_F);
```
