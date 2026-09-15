-- SQLコード一覧（実行テスト済み）

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
-- ・pit_job を廃止し pit_assignment（race_id, username, maintenance_area）に再設計
-- ・pit_log_history テーブルを新規追加（INSERT / UPDATE / DELETE の変更履歴管理）
-- ・pit_log に created_at / updated_at を追加
-- ・users.username に CHECK制約追加（ひらがな・カタカナ・漢字 4〜20文字）/ VARCHAR(20)に縮小
-- ・race.today_id に CHECK制約追加（半角英数字 15文字以上）
-- ・outpost_log テーブルを新規追加（showAll API の act=1 アクセスログ）
-- ・users.password_hash を廃止。ログイン認証を Cognito User Pool に移行し、
--   代わりに Cognito の userSub を持つ cognito_sub を追加（UNIQUE）
-----------------


-- ユーザの所属リスト（users より先に作成）

CREATE TABLE organizations (
    circuit INT          PRIMARY KEY, --サーキット番号 1=富士 2=茂木 3=菅生 4=鈴鹿 5=岡山国際 6=その他 7=無所属
    name    VARCHAR(100) NOT NULL UNIQUE
) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;


-- ログイン情報

CREATE TABLE users (
    id              INT          NOT NULL AUTO_INCREMENT,
    username        VARCHAR(20)  NOT NULL UNIQUE,  --担当者名（ひらがな・カタカナ・漢字 4〜20文字）
    cognito_sub     CHAR(36)     NOT NULL UNIQUE,  --Cognito の userSub（認証はCognito側で完結）
    organization_id INT          NOT NULL,
    admin       BOOLEAN      NOT NULL DEFAULT FALSE, --管理者フラグ（TRUE=管理者 FALSE=一般）
    created_at      TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
    updated_at      DATETIME     DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    FOREIGN KEY (organization_id) REFERENCES organizations(circuit),
    CONSTRAINT chk_username CHECK (
        CHAR_LENGTH(username) BETWEEN 4 AND 20
        AND username REGEXP '^[ぁ-んァ-ヶ一-龯]+$'
    )
) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;


-- レースタイトル表

CREATE TABLE race (
    id       INT          NOT NULL AUTO_INCREMENT,
    title    VARCHAR(200) NOT NULL UNIQUE,
    today_id VARCHAR(50)  NOT NULL UNIQUE, --大会ID（conform1 POST で照合）
    PRIMARY KEY (id),
    CONSTRAINT chk_today_id CHECK (
        CHAR_LENGTH(today_id) >= 15
        AND today_id REGEXP '^[A-Za-z0-9]+$'
    )
) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;


-- エントリーリスト

CREATE TABLE entry (
    race_id          INT          NOT NULL,
    car_num          INT          NOT NULL,
    class_name       VARCHAR(50),            --クラス名
    entrant_name     VARCHAR(100),           --エントラント名称
    vehicle_name     VARCHAR(100),           --参加車両名称
    maintenance_area VARCHAR(50),            --作業エリア（1〜45 または文字列）
    pit_garage       VARCHAR(20),            --ピットガレージ割り当て（1〜45 または "テント"）
    driver_a         VARCHAR(50)  NOT NULL,
    driver_b         VARCHAR(50),
    driver_c         VARCHAR(50),
    driver_d         VARCHAR(50),
    driver_e         VARCHAR(50),
    driver_f         VARCHAR(50),            --ドライバーは最大f（6名）まで。未登録は NULL
    PRIMARY KEY (race_id, car_num),          --複合主キー。car_num 単体では一意にならないため race_id を含む
    FOREIGN KEY (race_id) REFERENCES race(id)
) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;


-- スタートドライバー表

CREATE TABLE start_driver (
    race_id   INT         NOT NULL,
    car_num   INT         NOT NULL,
    driver    VARCHAR(50) NOT NULL,
    PRIMARY KEY (race_id, car_num),
    FOREIGN KEY (race_id, car_num) REFERENCES entry(race_id, car_num)
) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;


-- ユーザの監視割り当て表

CREATE TABLE pit_assignment (
    race_id          INT         NOT NULL,
    username         VARCHAR(20) NOT NULL,   --担当監視員（users.username）
    maintenance_area VARCHAR(50) NOT NULL,   --担当作業エリア（entry.maintenance_area と整合）
    PRIMARY KEY (race_id, username, maintenance_area),
    FOREIGN KEY (race_id)  REFERENCES race(id),
    FOREIGN KEY (username) REFERENCES users(username)
) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;


-- ピット監視記録

CREATE TABLE pit_log (
    id             INT         NOT NULL AUTO_INCREMENT,
    race_id        INT         NOT NULL,
    car_num        INT         NOT NULL,
    username       VARCHAR(20) NOT NULL,               --記録担当者名（users.username）
    pit_num        INT         NOT NULL,               --ピット回数（何回目か）
    in_time        DATETIME    NOT NULL,
    out_time       DATETIME,                           --NULL 許容。ガレージストップ時は2回目送信でUPDATE
    garage_in_time DATETIME,                           --ガレージイン時刻。ガレージストップ時のみ使用
    driver_out     CHAR(1),                            --NULL 許容。ガレージストップ時は2回目送信でUPDATE
    tire           BOOLEAN     NOT NULL DEFAULT FALSE, --タイヤ交換（TRUE=あり FALSE=なし）
    oil            BOOLEAN     NOT NULL DEFAULT FALSE, --燃料補給（TRUE=あり FALSE=なし）
    note           TEXT,
    created_at     DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at     DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE (race_id, car_num, pit_num),
    FOREIGN KEY (race_id, car_num) REFERENCES entry(race_id, car_num),
    FOREIGN KEY (username)         REFERENCES users(username)
) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;


-- ピット記録変更履歴

CREATE TABLE pit_log_history (
    id          INT         NOT NULL AUTO_INCREMENT,
    pit_log_id  INT         NOT NULL,               --対象ピット記録（pit_log.id）
    action_type VARCHAR(10) NOT NULL,               --操作種別（INSERT / UPDATE / DELETE）
    modified_by VARCHAR(20) NOT NULL,               --操作者（users.username）
    modified_at DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    field_name  VARCHAR(50),                        --変更項目（UPDATE のみ。例: out_time）
    old_value   TEXT,                               --変更前の値
    new_value   TEXT,                               --変更後の値
    PRIMARY KEY (id),
    FOREIGN KEY (pit_log_id)  REFERENCES pit_log(id),
    FOREIGN KEY (modified_by) REFERENCES users(username),
    INDEX idx_pit_log_history_log  (pit_log_id),
    INDEX idx_pit_log_history_user (modified_by, modified_at)
) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;


-- リタイア記録

CREATE TABLE retire (
    race_id    INT     NOT NULL,
    car_num    INT     NOT NULL,
    is_retired BOOLEAN NOT NULL DEFAULT FALSE, --リタイアフラグ（TRUE=リタイア FALSE=継続）
    reason     TEXT,                           --リタイア理由（selection=2 の reason）
    PRIMARY KEY (race_id, car_num),
    FOREIGN KEY (race_id, car_num) REFERENCES entry(race_id, car_num)
) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- outpostsアクセスログ（showAll API の act=1 アクセス時に記録）

CREATE TABLE outpost_log (
    id          INT         NOT NULL AUTO_INCREMENT,
    race_id     INT         NOT NULL,               --対象レースID
    username    VARCHAR(20) NOT NULL,               --アクセスした担当者名（JWTから取得）
    created_at  DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    FOREIGN KEY (race_id) REFERENCES race(id),
    FOREIGN KEY (username) REFERENCES users(username)
) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;


-- データをcsvファイルで一括登録するとき

LOAD DATA INFILE '/path/to/entry.csv'
INTO TABLE entry
FIELDS TERMINATED BY ','
ENCLOSED BY '"'
LINES TERMINATED BY '\r\n'
IGNORE 1 LINES
(race_id, car_num, class_name, entrant_name, vehicle_name,
 maintenance_area, pit_garage,
 driver_a, driver_b, driver_c, driver_d, driver_e, driver_f);
