# common.js 設計書（フロント共通処理）

全画面で読み込まれる共通スクリプト `htmls/a_js/common.js` の設計書。
定数・認証ガード・エラー処理・画面の区画切り替えを持つ。

**この設計書は「フロント共通」の正とする。** 各画面の設計書（[index.md](index.md) /
[regist.md](regist.md) / [forgetPass.md](forgetPass.md) / [userMenu1.md](userMenu1.md) ほか）は、
共通処理についてはここを参照する。

- [1. 読み込みの前提](#1-読み込みの前提)
- [2. 定数](#2-定数)
- [3. 認証情報の保管場所](#3-認証情報の保管場所)
- [4. 関数](#4-関数)
- [5. 画面の区画（article）](#5-画面の区画article)
- [6. 入力検証の判定表](#6-入力検証の判定表)
- [7. 区画切り替え showStep()](#7-区画切り替え-showstep)

---

## 1. 読み込みの前提

**`import` / `export` は使わない。** 各HTMLで他のスクリプトより**先に**
`<script defer src="a_js/common.js">` で読み込み、グローバル変数・グローバル関数として参照する。

```html
<script src="https://unpkg.com/amazon-cognito-identity-js@6/dist/amazon-cognito-identity.min.js"></script>
<script defer src="a_js/common.js"></script>   <!-- 必ず先 -->
<script defer src="a_js/passCheck.js"></script>
<script defer src="a_js/login.js"></script>
```

- `defer` のため、各スクリプトの実行時点で DOM は構築済み。`DOMContentLoaded` を待つ必要はない。
- Cognito SDK は**ログイン・登録・パスワード再設定の3画面だけ**が読み込む。それ以外の画面でも
  `common.js` は読み込まれるため、`cognitoPool` は **SDK がある時だけ生成し、無ければ `null`** にする
  （§2）。SDK 未読み込みのページで `ReferenceError` にならないようにするための措置。

### スクリプト間の暗黙の結合（2026-10-06 解消）

以前は `passConfirmCheck.js` が `passCheck.js` がトップレベルで宣言した `submitBtn` と
`passValidity` を参照しており、**読み込み順に依存した結合**になっていた
（`passConfirmCheck.js` を単独で読み込むと壊れる状態）。

§6 の判定表の導入で解消した。両スクリプトは `common.js` の `setValidity()` を呼ぶだけで、
互いを参照しない。そのため `index.html` のように `passCheck.js` を読み込まない画面を
作っても壊れない。

---

## 2. 定数

| 定数                 | 値・内容                                                                 | 使う場所                           |
| -------------------- | ------------------------------------------------------------------------ | ---------------------------------- |
| `API`                | API Gateway のベースURL（`.../dev`）                                     | 全API呼び出し                      |
| `COGNITO_POOL_ID`    | `ap-northeast-1_tGblsfFgk`                                               | `cognitoPool` の生成、`clearAuth`  |
| `COGNITO_CLIENT_ID`  | `6lh05mp69vfns3cfpj6hls4e7i`                                             | 同上                               |
| `cognitoPool`        | `CognitoUserPool` のインスタンス。**SDK 未読み込みなら `null`**          | index / regist / forgetPass        |
| `PUBLIC_PAGES`       | `["index.html", "regist.html", "forgetPass.html"]`                       | §4 の bfcache ガード               |
| `CIRCUIT_NAMES`      | サーキット番号 1〜7 → 名称。**添字0は `null`**（番号をそのまま添字に使うため） | conform / admin の表示           |

**Cognito の ID はフロントとバックエンドの2箇所にある。** `template.yaml` の
`COGNITO_USER_POOL_ID` / `COGNITO_CLIENT_ID` が Lambda Authorizer のトークン検証に使われる。
**片方だけ変えると認証が通らなくなるため、変更時は必ず両方を揃える**（[index.md](index.md) 参照）。

`CIRCUIT_NAMES` は `organizations.circuit` の並びに合わせる
（1:富士 / 2:茂木 / 3:菅生 / 4:鈴鹿 / 5:岡山国際 / 6:その他 / 7:無所属）。
`6:その他` と `7:無所属` も 1〜5 と同格の独立した区分
（[admin/v2/01_permission.md](../aws-sam/admin/v2/01_permission.md)）。

---

## 3. 認証情報の保管場所

| キー         | 保管先           | 入れる場所                      | 中身                                                     |
| ------------ | ---------------- | ------------------------------- | -------------------------------------------------------- |
| `token`      | `sessionStorage` | `login.js`                      | Cognito の **ID トークン**。`Authorization: Bearer` で送る |
| `raceToken`  | `sessionStorage` | `conform.js`                    | 署名付き raceId トークン。`X-Race-Id` で送る（[raceIdToken.md](raceIdToken.md)） |
| `circuit`    | `sessionStorage` | `conform.js`（`GET /user/me`）  | 所属サーキット番号。admin 画面の表示出し分けにのみ使う   |
| Cognito セッション | `localStorage` | Cognito SDK が自動で書く      | `CognitoIdentityServiceProvider.<ClientId>.*`            |

**sessionStorage は利用者が書き換えられる。** フロントの検証は画面を出し分けるためだけのもので、
安全の根拠は各 Lambda にある（[admin/v2/01_permission.md](../aws-sam/admin/v2/01_permission.md) §3）。

### localStorage を全消ししてはいけない

`clearAuth()` は `sessionStorage` は全消しするが、`localStorage` は
**`CognitoIdentityServiceProvider.<ClientId>` で始まるキーだけ**を消す。

`localStorage.clear()` は使えない。入力画面（enterAuto）が送信失敗時の一時保存
（`unsentData`）と送信ログを `localStorage` に置いているため、全消しするとそれらが失われる。
**この制約は、入力画面の一時保存の設計を変える際にも維持すること。**

---

## 4. 関数

### `clearAuth()`

認証情報を全部消す。`sessionStorage.clear()` ＋ Cognito が書いた `localStorage` のキーのみ削除（§3）。

### `logout()`

`clearAuth()` の後、`window.location.replace("./index.html")` で遷移する。

**`href` ではなく `replace` を使う。** 履歴を置き換えるので、戻るボタンでログアウト前の画面に
戻れない（[nextJob.md](../../../nextJob.md) の「仕様変更」で求められている挙動）。

ヘッダーの `#logoutBtn`（admin / main / conform 共通）には `common.js` が自動で紐付ける。
各画面のJSで登録する必要はない。

**ログアウトボタンはヘッダーに置く。** 3画面とも `<header>` の中で、
`a_css/common.css` が右端に絶対配置する。

- **位置の指定は `header #logoutBtn` にスコープしてある**（2026-10-07）。
  以前は `#logoutBtn` に直接 `position: absolute` を当てていたため、ボタンを
  ヘッダーの外に移すと絶対配置が付いてきて画面に浮いた。打ち消すために移動先の
  CSS で `position: static` を書く必要があり、置き場所を変えるたびに追従が要る形だった。
- 見た目（色・余白・角丸）は `#logoutBtn` のままなので、どこに置いても同じ。
- **狭い画面用の媒体クエリも `header #logoutBtn` で書くこと。**
  `#logoutBtn` だけだと詳細度が低く（IDセレクタ1つ 対 ID＋要素）、
  絶対配置を打ち消せない。

### 「確認画面に戻る」（`#backToConformBtn`、2026-10-09追加）

ヘッダーの **左端**に置く。押すと `conform.html` へ移動する。
**大会IDを入れ直したいとき・別のレースに入り直したいとき**に使う。

| | `#backToConformBtn` | `#logoutBtn` |
| --- | --- | --- |
| 置く画面 | admin / main（**conform 自身には置かない**） | admin / main / conform |
| 位置 | ヘッダー左端 | ヘッダー右端 |
| 色 | 灰（`#6b7280`） | 赤（`#dc2626`） |
| 認証情報 | **消さない** | `clearAuth()` で消す |
| 遷移 | `href`（ブラウザの戻るで帰れる） | `replace`（戻れない） |

- 紐付けは `common.js` が自動で行う（`#logoutBtn` と同じ形）。各画面のJSで登録しない。
  以前は `adminRace.js` が admin 用に独自に登録していたが、main にも置くにあたって
  共通側へ寄せた。
- 位置の指定は `header #backToConformBtn` にスコープする。理由は `#logoutBtn` と同じ。
- **ログアウトと左右に分ける。** 押し間違えると認証ごと消えてしまうため、
  色も変えて並べない。

### bfcache ガード（`pageshow`）

戻る／進むでブラウザキャッシュ（bfcache）から復元されたとき、`token` が無ければログイン画面へ
`replace` する。`PUBLIC_PAGES`（§2）に載っているページは対象外。

`e.persisted` が true のときだけ判定する。通常の読み込みでは各画面の `requireAuth()` が担う。

### `requireAuth(needRaceToken = false)`

一般利用者向け画面の認証ガード。

| 戻り値                  | 条件                                                         |
| ----------------------- | ------------------------------------------------------------ |
| `{ token, raceToken }`  | 必要なものが揃っている                                       |
| `null`                  | 不足。**alert を出してログイン画面へ `replace` 済み**        |

`needRaceToken = true` のときは `raceToken` も必須にする。呼び出し側は
`const auth = requireAuth(true); if (!auth) return;` の形で早期離脱する。

**使い分けの実績:**

| 呼び出し                | 使う画面                                                                         |
| ----------------------- | -------------------------------------------------------------------------------- |
| `requireAuth()`         | conform（まだ raceToken を持っていないため）                                     |
| `requireAuth(true)`     | enterAuto / enterHand / enterUpdate / enterRetire / showAll / outPosts / startDriver |

### `isTokenExpired(token)` / `logoutExpired()`（2026-10-09追加）

**ログインの有効期限が切れたら、認証情報を消してログイン画面へ戻す。**

Cognito の ID トークンは既定で1時間で切れる。切れた状態でAPIを叩くと、API Gateway の
Authorizer が拒否し、**そのレスポンスには CORS ヘッダーが付かない**ため、ブラウザからは
「CORSエラー」＝ `fetch` の例外にしか見えない（01章§7）。例外の中身からは
**通信断と区別が付かない**。

そこで `isTokenExpired()` が**トークンの中身（`exp`）を直接見る**。ID トークンは
`ヘッダー.中身.署名` の形で、中身は Base64URL の JSON。`exp`（UNIX秒）を現在時刻と比べる。

- **これは表示の出し分けにしか使わない。** 安全の根拠はサーバー側の署名検証（01章§3）。
  読めない・`exp` が無い場合は「切れていない」とみなし、サーバーの判断に任せる。
- `logoutExpired()` は `clearAuth()` →「ログインの有効期限が切れました。もう一度
  ログインしてください。」→ ログイン画面へ `replace`。

**見る場所は4つ。**

| 場所 | いつ見るか |
| --- | --- |
| `requireAuth()` | **送る前**。切れていれば叩かずに戻す（画面を開いた時点でも効く） |
| `apiFetch()` の `catch` | 例外が出たとき。切れていればログインへ、そうでなければ「通信に失敗しました」 |
| `enterAuto` / `enterHand` の初期取得の `catch` | 同上。**切れている場合は再試行しない**（何度試しても通らないため） |
| `adminFetch()` の `catch` | 同上（管理者画面） |

### `requireCircuitAuth()`

管理者画面（admin）用。`token` と `circuit` の両方が無ければ **conform.html へ** `replace` する
（ログイン画面ではない）。戻り値は `{ token, circuit }` または `null`。

**leader かどうかは判定しない。** 管理者かの確認は各APIの 403 に任せる。ここでやるのは
見た目の出し分けだけ（[admin/v2/01_permission.md](../aws-sam/admin/v2/01_permission.md) §3）。

### `handleApiError(response, data)`

API レスポンスの共通処理。**エラーなら alert を出して `true` を返す**ので、呼び出し側は
`if (handleApiError(response, data)) return;` で早期離脱できる。

| 条件                              | 挙動                                                             |
| --------------------------------- | ---------------------------------------------------------------- |
| `response.ok` かつ `msg === ""`   | `false` を返す（正常）                                           |
| `response.ok` だが `msg` が非空   | `msg` を alert して `true`                                       |
| 400                               | `msg` を alert（既定文言「error: 400 Bad Request」）             |
| **401**                           | **`clearAuth()` で認証情報を消し**、alert の後 **ログイン画面へ `replace`**（2026-10-09追加。消さないと期限切れのトークンが `sessionStorage` に残っていた。01章§7） |
| 500                               | `msg` を alert（既定文言「error: 500 Internal Server Error」）   |
| **403 で `reason: "race_finished"`** | `msg` を alert し、**conform.html へ `replace`**（2026-10-09追加。下記） |
| それ以外（403 / 404 / 409 など）  | `msg` を alert するだけ                                          |

**全APIの成功レスポンスは `{"msg": ""}` を含む約束になっている。** `msg` が空文字でないものは
`200` でもエラーとして扱う。

#### `reason` を見るのは管理者画面だけ（2026-10-09更新）

バックエンドは 403 の body に `reason`（`not_admin` / `user_not_found` / `race_finished`）を
付けて理由を区別できるようにしている（[admin/v2/01_permission.md](../aws-sam/admin/v2/01_permission.md)）。
**`handleApiError` 自身はこれを参照しない。** 403 はすべて「それ以外」の経路で `msg` を alert するだけ。

- **管理者画面は `adminFetch`（`adminRace.js`）で分岐する。** `not_admin` / `user_not_found` なら
  `msg` を出して conform.html へ戻す（01章§7）。`handleApiError` 側に入れていないのは、
  `GET /user/me` も `user_not_found` で403を返し、それを呼ぶのが conform.html 自身のため
  （共通処理に入れると conform が自分自身へ戻り続ける）。
- **一般画面は `race_finished` だけ `handleApiError` が扱う（2026-10-09確定）。** `msg` を出して
  **conform.html へ戻す。** そのまま入力を続けても全て失敗するうえ、`race_finished` は
  **`raceToken` の期限切れでも返る**（終了日が無いレースはトークンが2時間で切れる。
  [raceIdToken.md](raceIdToken.md)、[userMenu1.md](userMenu1.md)）。conform へ戻れば
  大会IDを入れ直して新しいトークンを取れるため、戻すほうが作業を続けられる。
  - **conform 自身がこれを受けたときは移動しない**（終了したレースの大会IDを入れた場合）。
    同じ画面へ `replace` すると入力内容とメッセージが消えるため、`location.pathname` で
    判定して除外している。
  - **管理者画面は移動しない**（01章§7）。終了済みのレースも一覧で扱うため、
    `adminFetch` が `race_finished` を先に受け止めて `handleApiError` に渡さない。

### `apiFetch(url, options)`（2026-10-09追加）

一般画面のAPI呼び出し口。**成功ならレスポンスのデータ、失敗なら `null`** を返すので、
呼び出し側は `const data = await apiFetch(...); if (!data) return;` の形で早期離脱する。
中で `handleApiError` を呼ぶため、エラーの alert はこれまでと同じ。

**作った理由は `fetch` の例外。** 不正なトークンは API Gateway が Authorizer の拒否として返し、
そのレスポンスには CORS ヘッダーが付かないためブラウザでは `fetch` が例外になる。通信が
切れた場合も同じ。`try` を書いていない画面ではこの例外が誰にも拾われず、
**「押しても何も起きない」**状態になっていた（`enterUpdate` の取得・`startDriver` の2箇所、
`enterHand` / `enterUpdate` / `enterRetire` の送信は `finally` だけで `catch` が無かった）。

| | 一般画面の `apiFetch` | 管理者画面の `adminFetch` |
| --- | --- | --- |
| `fetch` が例外 | alert を出して**その画面に留まる** | 認証を消して**ログイン画面へ**（01章§7） |
| 403 の `reason` | 見ない | `not_admin` / `user_not_found` で conform.html へ |

**例外時に留まるのは意図的。** サーキットは電波が悪いことがあり、入力画面は未送信データを
端末に持って再送する作りなので、通信が切れただけでログイン画面へ飛ばすと入力中のものを失う。

**使っていない画面もある（意図的）。** 独自の後処理を持つものは `fetch` のままにしてある。

| 画面 | 理由 |
| --- | --- |
| `enterAuto`（取得・送信） | 送信失敗時に未送信データを `localStorage` に保存し、専用の文言を出す |
| `enterHand`（取得） | 失敗したら回数を減らして再試行する |
| `enterRetire`（リタイア済み一覧） | 失敗を alert ではなく画面内のメッセージで出す（フォームは使えるまま） |
| `showAll` / `outPosts` | 取得が1箇所だけで、専用の文言を出している |
| `conform` / `regist` | 再試行・Cognito との組み合わせがあり、共通化の対象外 |

### `showStep(id)` / `finishTo(page, delay)` / `refreshSubmit()` ほか

区画の切り替えと入力検証の判定表。§6・§7 で詳述する。

**`sucsessMsg()` は 2026-10-06 に廃止した。** `#formArea` と `#msgArea` の2区画しか
前提にしておらず、区画が3つ以上ある画面で隠し漏れが出ていた。また呼び出し側が直後に
同期的にページ遷移していたため、メッセージが実際には描画されていなかった。
現在は `finishTo()` が「見せてから遷移する」を担う（§7）。

---

## 5. 画面の区画（article）

フォーム画面は `<article>` を区画として並べ、表示を切り替えて段階を進める。
**区画の名前は画面ごとに違う。**

| 画面                | 区画1          | 区画2                        | 区画3        |
| ------------------- | -------------- | ---------------------------- | ------------ |
| `index.html`        | `#formArea`    | —                            | `#msgArea`   |
| `regist.html`       | `#formArea`    | `#codeArea`（確認コード）    | `#msgArea`   |
| `forgetPass.html`   | `#formArea`    | `#codeArea`（コード＋新パス）| `#msgArea`   |
| `conform.html`      | `#formArea`    | **`#conform`**（プロフィール）| `#msgArea`   |

**conform.html の2番目の区画は `#codeArea` ではなく `#conform`。**
`STEP_AREAS`（§7）にこの名前を含めないと conform.html で切り替えが動かない。
`conform.js` も `finishTo()` を使うため、漏らすと隠し残りが起きる。

### 隠し方は `hidden` 属性に統一する（2026-10-06）

**初期状態で隠す区画には HTML で `hidden` を付け、切り替えは `el.hidden` で行う。**
`style.display` は使わない。

以前は指定方法が2通り混在していた。

- インライン `style="display: none"` → regist / forgetPass の `#codeArea`、conform の `#conform` と `#msgArea`
- **CSS** `a_css/formPage.css` の `#msgArea { display: none; color: green; }` → index / regist / forgetPass の `#msgArea`

**CSSの方を残したまま `hidden` に切り替えると表示できなくなる。**
`[hidden]`（ブラウザ既定）よりIDセレクタの方が優先度が高いため、`el.hidden = false` で
属性を外しても `display: none` が残る。以前の `sucsessMsg()` が動いていたのは、
インラインスタイル（`msg.style.display = "block"`）がCSSに勝っていたから。

このため `formPage.css` から `display: none` を外した（`color: green` は残した）。
**同種の罠を避けるため、区画の表示・非表示をCSSで指定しないこと。**

なお `conform.css` の `button, input[type="submit"], .btn { display: block }` は
**ボタンに対して `hidden` が効かなくなる**指定だが、区画は `<article>` なので影響しない。
ボタン自体を `hidden` で隠したくなった場合は注意が必要。

---

## 6. 入力検証の判定表

**2026-10-06 実装済み。**

### 背景

送信ボタンの有効・無効を `passCheck.js` と `passConfirmCheck.js` が**別々に書いており**、
あとから走った方が前の判定を上書きしていた。確認用パスワードの一致結果がどこにも
記録されないため、`passCheck.js` 側からは見えない。結果として次の2つが起きていた。

- **regist**: パスワードと確認用を一致させた後にパスワード欄を編集すると、不一致のまま送信できる
- **forgetPass**: 確認用が空のまま「パスワードを再設定」を押せる（ボタンが `type="button"` で
  `required` / `minlength` が評価されないため、標準検証も働かない）

### 設計

**送信ボタンの状態を決めるのは1つの関数だけ**にし、各検証スクリプトは
**自分の合否を共通の表に書き込むだけ**にする。

```js
// 画面内の入力欄ごとの合否。検証スクリプトが書き込み、refreshSubmit が読む。
const formValidity = new Map();

// 今の区画の中にある送信ボタン。区画ごとにボタンが違うため毎回探す。
function currentSubmit() {
  const area = currentStep ? document.getElementById(currentStep) : null;
  return area ? area.querySelector("[data-submit]") : null;
}

// 送信ボタンの有効・無効を決める唯一の場所。
function refreshSubmit() {
  const btn = currentSubmit();
  if (!btn) return;
  btn.disabled = ![...formValidity.values()].every(Boolean);
}

// 検証スクリプトからの合否の書き込み口。
// 今の区画に属さない欄からの通知は無視する。
function setValidity(id, ok) {
  if (!formValidity.has(id)) return;
  formValidity.set(id, ok);
  refreshSubmit();
}

// 区画を開いたときに、その中の検証対象を false で登録し直す。
function registerStepFields(areaId) {
  formValidity.clear();
  const area = document.getElementById(areaId);
  if (area) {
    area
      .querySelectorAll("[data-passcheck], [data-confirms], [data-required]")
      .forEach((input) => formValidity.set(input.id, false));
  }
  refreshSubmit();
}
```

### 送信ボタンは区画ごとに決まる

`refreshSubmit()` は **`#submit` を固定で見ない。** 今表示している区画の中にある
`[data-submit]` を探す。regist.html のように区画ごとに別のボタンがある画面に対応するため。

| 区画                        | `[data-submit]` を付けるボタン          |
| --------------------------- | --------------------------------------- |
| regist の `#formArea`       | `#submit`（アカウント登録）             |
| regist の `#codeArea`       | `#confirmCodeBtn`（確認する）           |
| forgetPass の `#codeArea`   | `#submit`（パスワードを再設定）         |
| index / conform / forgetPass の `#formArea` | **付けない**（下記）    |

**`[data-submit]` を付けない区画では、判定表は何もしない。** 検証対象の欄が無い区画
（index のログイン、conform の大会ID、forgetPass のメール入力）は、`<form>` の
標準検証に任せる。ボタンが見つからなければ `refreshSubmit()` は何もせずに戻るため、
既存の挙動が変わらない。

**「コードを再送信」のようなボタンには付けない。** 付けると判定表が揃うまで再送信が
できなくなる。

### 判定表の持ち方 — 「通ったら足す」ではない

| やり方                                              | 未入力の欄            | 結果                                                                   |
| --------------------------------------------------- | --------------------- | ---------------------------------------------------------------------- |
| 通った欄だけを**足す**                              | 表に載らない          | **未入力の欄が「問題なし」として扱われる**（forgetPass の不具合の正体） |
| 監視開始時に **`false` で登録**し、入力ごとに上書き | `false` として表に載る | 一度も触られていない欄があればボタンは開かない                         |

**必ず後者にすること。** `every(Boolean)` は表に無いものを見ないため、前者では
空の必須欄を見逃す。

登録は `registerStepFields()` が**区画を開いた時点でまとめて行う**。
各検証スクリプトは `setValidity()` で上書きするだけで、自分で登録しない。
これにより、区画が切り替わると判定表もその区画の欄に組み替わる。

### 属性と役割

| 属性                   | 検証内容                                     | 担当スクリプト          | 置く場所                           |
| ---------------------- | -------------------------------------------- | ----------------------- | ---------------------------------- |
| `data-passcheck`       | パスワードの強度（下記）                     | `passCheck.js`          | regist / forgetPass のパスワード欄 |
| `data-confirms="id"`   | 指定した欄と**一致**するか                   | `passConfirmCheck.js`   | 確認用パスワード欄                 |
| `data-required`        | **空でない**こと（規則の無い必須欄のため）   | `common.js`             | 確認コード欄（`#code`）            |
| `data-errmsg="id"`     | エラー文言の表示先                           | 上記すべて              | 上記すべて                         |
| `data-submit`          | （検証ではない）その区画の送信ボタン         | `common.js`             | 上表のボタン                       |

**確認用の検証は、参照先の欄の変更も監視する。** 自分の `input` だけでなく
`data-confirms` が指す欄の `input` でも再判定する。これがないと、一致させた後に
本体を編集したときに古い判定が残る。

### パスワードの強度規則（regist / forgetPass の2画面）

| 項目       | 規則                                    |
| ---------- | --------------------------------------- |
| 文字数     | 6〜20文字                               |
| 小文字     | 1文字以上必須                           |
| 大文字     | 1文字以上必須                           |
| 数字       | 1文字以上必須                           |
| 使える文字 | **半角英数字のみ**（記号・全角は不可）  |

**Cognito のパスワードポリシーより厳しい。** Cognito 側は「記号必須 OFF」＝記号を使ってよい
設定だが（[cognitoSetting.md](../aws-sam/cognitoSetting.md) §2）、フロントは記号を許さない。
コンソールからパスワードを設定する場合は**半角英数字のみ・20文字以内**にすること。

### `type="button"` でも安全になる

regist の「確認する」と forgetPass の「パスワードを再設定」は
`type="button"` + `onclick` のため、**ブラウザの標準検証（`required` / `minlength`）が
一切働かない。** 判定表が全欄 OK になるまでボタンを `disabled` にしておくことで、
フォーム送信でないことを突かれても素通りしない。

このため**HTMLを `<form>` に組み替える必要がなかった。**

### ログイン画面は判定表の対象外

**`index.html` は判定表に載せず、`<form>` の標準機能だけに任せる**（2026-10-06 決定）。
ログインは「既に決まっているパスワードを入れる」操作であり、登録時の強度規則を再主張する
意味がない。

| 検証したいこと             | 効かせる方法                      |
| -------------------------- | --------------------------------- |
| メールアドレスが空でない   | `required`                        |
| メールアドレスの形式       | `type="email"`                    |
| パスワードが空でない       | `required`                        |
| パスワードが6〜20文字      | `minlength="6"` / `maxlength="20"` |

**これが効く理由:** `index.html` の送信は実際の `<form>` の submit で、ブラウザの制約検証は
**submit イベントが発火する前**に走る。不合格なら `login.js` のハンドラ自体が呼ばれない。
`forgetPass.html` のステップ2が素通りするのは `type="button"` + `onclick` でフォーム送信では
ないからで、ログイン画面はその問題を持たない。

ログイン画面から外したもの（追加はゼロ。属性は既に揃っていた）。

- `data-passcheck` と `data-errmsg`
- 使われなくなった `<small id="errMsg">`
- `passCheck.js` の `<script>` タグ（監視対象が無くなるため）

**記号入りパスワードの利用者がログインできない問題も、これで解消した。**

---

## 7. 区画切り替え `showStep()`

**2026-10-06 実装済み。**

`sucsessMsg()` を廃止し、**「どの区画を見せるか」を1つの関数に集めた**。

```js
// 指定した区画だけを表示し、他は隠す。存在しない区画は無視する。
// conform.html の 2番目の区画は #codeArea ではなく #conform（§5）。
const STEP_AREAS = ["formArea", "codeArea", "conform", "msgArea"];

let currentStep = null;

function showStep(id) {
  currentStep = id;
  for (const name of STEP_AREAS) {
    const el = document.getElementById(name);
    if (el) el.hidden = name !== id;
  }
  registerStepFields(id); // 判定表をこの区画の欄に組み替える（§6）
}

// 初期表示の区画を判定表に反映する。HTML の hidden が初期状態の正。
(function initStep() {
  const visible = STEP_AREAS.find((name) => {
    const el = document.getElementById(name);
    return el && !el.hidden;
  });
  if (visible) showStep(visible);
})();
```

**`showStep()` は区画の表示と判定表の組み替えを同時に行う。** 片方だけ動かす手段は
用意していない。区画が変わればその区画の入力欄が検証対象になる、という対応を崩さないため。

### 併せて行った変更

- **`formPage.css` の `#msgArea` から `display: none` を外した**（`color: green` は残した）。
  残したままだと `hidden` を外しても表示されない（§5）。
- 各HTMLのインライン `style="display: none"` を `hidden` 属性に置き換えた。
- 各JSの `style.display = "..."` を `showStep()` に置き換えた
  （`regist.js` の `checkCode()`、`forgetPass.js` の `showCodeArea()`、
  `conform.js` の `prof()` / `back()`）。
- `conform.js` の未使用の DOM 参照（`main` / `conform` / `success`）を削除した。
  `#success` は conform.html に存在せず、常に `null` だった。

### 成功時は、見せてから遷移する

```js
// 成功メッセージを見せてから遷移する。
function finishTo(page, delay = 500) {
  showStep("msgArea");
  setTimeout(() => window.location.replace(page), delay);
}
```

| 呼び出し元        | 遷移先          |
| ----------------- | --------------- |
| `login.js`        | `conform.html`  |
| `conform.js`      | `main.html`     |
| `regist.js`       | `index.html`    |
| `forgetPass.js`   | `index.html`    |

変更点は3つ。

1. **区画を元に戻す `setTimeout` を捨てる。** 遷移するので戻す意味がない。
2. **遷移を 500ms 待たせる。** 成功メッセージが実際に見える。
   元の `sucsessMsg()` の 500ms は「フォームを元に戻すまでの時間」であり表示時間として
   設計されたものではなかったが、慣れた値を引き継ぐ。
3. **`href` ではなく `replace` を使う。** 完了した画面に戻るボタンで帰れてしまうのを防ぐ。
   `logout()` と考え方を揃える（§4）。

---

## 関連ドキュメント

| ドキュメント                                                              | 内容                                       |
| ------------------------------------------------------------------------- | ------------------------------------------ |
| [index.md](index.md)                                                      | ログイン画面。Cognito の ID、Authorizer が渡す値 |
| [regist.md](regist.md)                                                    | 登録画面。入力項目と送り先                 |
| [forgetPass.md](forgetPass.md)                                            | パスワード再設定画面                       |
| [raceIdToken.md](raceIdToken.md)                                          | `raceToken` の構造・発行・検証             |
| [cognitoSetting.md](../aws-sam/cognitoSetting.md)                         | User Pool の設定（認証フロー・ポリシー）   |
| [admin/v2/01_permission.md](../aws-sam/admin/v2/01_permission.md)         | 権限モデル。フロントとバックエンドの責務分担 |
