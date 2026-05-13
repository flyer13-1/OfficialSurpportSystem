SQLコード一覧（実行テスト済み）

-- 変更履歴 --
-- ・organizations に circuit カラム追加（サーキット番号）
-- ・entry のPKを (race_id, car_num) の複合主キーに変更。class_name / entrant_name / vehicle_name を追加。
--   driver_A の UNIQUE 制約を削除。pit_num を pit_log に移動
-- ・entry に maintenance_area（整備エリア）/ pit_garage（ピットガレージ割り当て）を追加
-- ・pit_log に manager / pit_num / none_time を追加。
--   refueled / tire_changed (ENUM) → oil / tire (TINYINT boolean) に変更。
--   out_time を NULL 許容に変更（none_time 使用時）。remarks → note にリネーム
-- ・pit_log の none_time → garage_in_time にリネーム（ガレージストップ設計の確定）
-- ・entry に start_driver を追加（スタートドライバー編成。ALTER TABLE + CSV ロードで別管理）
-- ・race に today_id を追加（大会ID。conform1 の POST で照合するパスワード相当）
-- ・retire テーブルを新規追加
-- ・member_number は廃止
-----------------


・ユーザの所属リスト（users より先に作成）

CREATE TABLE organizations (
    circuit INT PRIMARY KEY,--サーキット番号 1=富士 2=茂木 3=菅生 4=鈴鹿 5=岡山国際 6=その他 7=無所属
    name VARCHAR(100) NOT NULL UNIQUE
);


・ログイン情報

CREATE TABLE users (
    id              INT AUTO_INCREMENT,
    username        VARCHAR(50)  NOT NULL UNIQUE, --担当者名
    password_hash   CHAR(256)    NOT NULL,        --ハッシュ化されたパスワード
    organization_id INT          NOT NULL,
    created_at      TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
    updated_at      DATETIME     DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    FOREIGN KEY (organization_id) REFERENCES organizations(circuit)
);


・レースタイトル表

CREATE TABLE race (
    id       INT          NOT NULL AUTO_INCREMENT,
    title    VARCHAR(200) NOT NULL UNIQUE,
    today_id VARCHAR(50)  NOT NULL UNIQUE, --大会ID（conform1 POST で照合）
    PRIMARY KEY (id)
);


・エントリーリスト

CREATE TABLE entry (
    race_id      INT          NOT NULL,
    car_num      INT          NOT NULL,
    class_name   VARCHAR(50),            --クラス名
    entrant_name VARCHAR(100),           --エントラント名称
    vehicle_name VARCHAR(100),           --参加車両名称
    maintenance_area VARCHAR(50),           --作業エリア（R1整備I①。車両の実整備場所）
    pit_garage       VARCHAR(20),           --ピットガレージ割り当て（PI）
    driver_A         VARCHAR(50) NOT NULL,
    driver_B         VARCHAR(50),
    driver_C         VARCHAR(50),
    driver_D         VARCHAR(50),
    driver_E         VARCHAR(50),
    driver_F         VARCHAR(50),           --ドライバーは最大F（6名）まで。未登録は NULL
    PRIMARY KEY (race_id, car_num),         --複合主キー。car_num 単体では一意にならないため race_id を含む
    FOREIGN KEY (race_id) REFERENCES race(id)
);


・データをcsvファイルで一括登録するとき

LOAD DATA INFILE '/path/to/entry.csv'
INTO TABLE entry
FIELDS TERMINATED BY ','
ENCLOSED BY '"'
LINES TERMINATED BY '\n'
IGNORE 1 LINES
(race_id, car_num, class_name, entrant_name, vehicle_name,
 maintenance_area, pit_garage,
 driver_A, driver_B, driver_C, driver_D, driver_E, driver_F);


・スタートドライバー編成

ALTER TABLE entry ADD COLUMN start_driver CHAR(1) NOT NULL;

・スタートドライバーをcsvで一括登録するとき

LOAD DATA INFILE '/path/to/start_driver.csv'
INTO TABLE entry
FIELDS TERMINATED BY ','
ENCLOSED BY '"'
LINES TERMINATED BY '\n'
IGNORE 1 LINES
(race_id, car_num, start_driver);


・ピット監視記録

CREATE TABLE pit_log (
    id         INT          NOT NULL AUTO_INCREMENT,
    race_id    INT          NOT NULL,
    car_num    INT          NOT NULL,
    manager    VARCHAR(50)  NOT NULL,          --記録担当者名（users.username）
    pit_num    INT          NOT NULL,          --ピット回数（何回目か）
    in_time    DATETIME     NOT NULL,
    out_time   DATETIME,                       --NULL 許容。ガレージストップ時は2回目送信でUPDATE
    garage_in_time DATETIME,                   --ガレージイン時刻。ガレージストップ時のみ使用
    in_driver  CHAR(1)      NOT NULL,
    out_driver CHAR(1),                        --NULL 許容。ガレージストップ時は2回目送信でUPDATE
    tire       TINYINT(1)   NOT NULL DEFAULT 0, --タイヤ交換 boolean（1=あり 0=なし）
    oil        TINYINT(1)   NOT NULL DEFAULT 0, --燃料補給 boolean（1=あり 0=なし）
    note       TEXT,
    PRIMARY KEY (id),
    FOREIGN KEY (race_id, car_num) REFERENCES entry(race_id, car_num),
    FOREIGN KEY (manager) REFERENCES users(username)
);


・リタイア記録（新規）

CREATE TABLE retire (
    race_id INT          NOT NULL,
    car_num INT          NOT NULL,
    retire  TINYINT(1)   NOT NULL DEFAULT 0, --boolean（1=リタイア 0=継続）
    reason  TEXT,                             --リタイア理由（selection=2 の reason）
    PRIMARY KEY (race_id, car_num),
    FOREIGN KEY (race_id, car_num) REFERENCES entry(race_id, car_num)
);
