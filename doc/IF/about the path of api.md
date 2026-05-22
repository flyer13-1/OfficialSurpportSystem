index.html /login
regist.html /user
forgetPass.html /user/password

userMenu.html /user/me (POST: 大会ID照会), /user/me (GET: プロフィール取得)
mainMenu.html /entries

html_Enter/enterAuto.html /entries/init (GET), /entries/auto (POST)
html_Enter/enterHand.html /entries/init (GET), /entries/hand (POST)
html_Enter/enterUpdate.html /entries/update (GET: 変更対象取得), /entries/update (PUT: 記録変更/リタイア)
html_Enter/enterRetire.html /entries/retire (GET: 初期データ取得), /entries/retire (POST: リタイア登録)

showAll.html /entries/show
output.html /entries/show

--- 新規追加API ---
/user/password (POST: パスワード変更)
/entry/bulk (POST: エントリー一括登録)
/entry/start-driver/bulk (POST: スタートドライバー一括登録)
