//最初の宣言
const express = require("express");
const path = require("path");
const app = express();
const PORT = 8080;

//データの送受信をjsonで行う
app.use(express.json());

//アクセス時に最初に開く画面
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "html", "login.html"));
});

//静的ファイルの参照先
app.use(express.static(path.join(__dirname, "html")));

//各routerの設定
const loginRouter = require("./routes/login");
app.use("/login", loginRouter);

const enterRouter = require("./routes/enter");
app.use("/enter", enterRouter);

const showRouter = require("./routes/show");
app.use("/show", showRouter);

const deleteRouter = require("./routes/delete");
app.use("/delete", deleteRouter);

//エラー発生時のコード
function error500() {
  res
    .status(500)
    .send(
      "サーバ側でエラーが発生しました。早急に管理者にご連絡ください。また管理者から連絡がくるまでシステムの利用はご遠慮ください。",
    );
}

//サーバの起動
app.listen(PORT, () => {
  console.log("サーバが起動---starting server");
});
