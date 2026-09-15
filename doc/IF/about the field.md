ログイン・登録・パスワード再設定で利用

各フィールドの入力バリデーション仕様（フロントエンド・バックエンドで共通）。
フロント（HTML pattern / passCheck.js）とバックエンド（各 Lambda の正規表現）は
この仕様に一致させること。

---

## 担当者名（username）

無線で呼ばれている名前を入力。showAll でも利用するため誰が見ても認識できるものとし、
アカウント名はすべてのデータで一意とする。

- 使用可能文字：ひらがな・カタカナ・漢字のみ
  - 長音符「ー」、中点「・」、半角カナ、英数字、記号は不可
- 文字数：4文字以上 20文字以下
- 正規表現：`/^[ぁ-んァ-ヶ一-鿿㐀-䶿]{4,20}$/`
  - `ぁ-ん`＝ひらがな / `ァ-ヶ`＝カタカナ(長音符「ー」は含まない) /
    `一-鿿`＝漢字(U+4E00–U+9FFF) / `㐀-䶿`＝CJK拡張A(U+3400–U+4DBF)
- 使用箇所：login（フロントのみ。Cognito authenticateUser の Username） / register（フロント + register.mjs） / forgetPass（フロントのみ。Cognito forgotPassword の Username）

## パスワード（password）

各アカウントのパスワード。

- 使用可能文字：半角英数字のみ（記号・全角不可）
- 構成条件：大文字・小文字・数字をそれぞれ1文字以上含む
- 文字数：6文字以上 20文字以下
- 正規表現：`/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)[A-Za-z0-9]{6,20}$/`
- 使用箇所：login（フロントのみ。Cognitoが照合） / register（フロントのみ。Cognito signUp）
  / forgetPass（フロントのみ。Cognito confirmPassword の newPassword）
  ※ いずれもバックエンドLambdaでのパスワード検証は行わない（Cognitoが一元管理）

## 大会ID（raceid / todayId）

各大会ごとに用意する予測不可能なID。

- 使用可能文字：半角英数字 と 記号 `-` `_` `!`
- 文字数：15文字以上
- 正規表現：`/^[A-Za-z0-9\-_!]{15,}$/`
- 使用箇所：conform（POST /user/me の todayId）
