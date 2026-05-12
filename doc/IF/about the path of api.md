login.html /login
regist.html /user
forgetPass.html /user/password

conform.html /user/me (POST: 大会ID照会), /user/me (GET: プロフィール取得)
main.html /entries

autoEnter.html /entries/init (GET), /entries/auto (POST)
handEnter.html /entries/init (GET), /entries/hand (POST)
updateEnter.html /entries/update (GET: 変更対象取得), /entries/update (PUT: 記録変更/リタイア)

showAll.html /entries/show
output.html /entries/show

--- 新規追加API ---
/user/password (POST: パスワード変更)
/pitlog/garage-out (PUT: ガレージアウト更新)
/entry/bulk (POST: エントリー一括登録)
/entry/start-driver/bulk (POST: スタートドライバー一括登録)
