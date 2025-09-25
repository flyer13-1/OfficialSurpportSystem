//最初の宣言
const express = require("express");
const path = require("path");
const app = express();
const PORT = 8080;

//データの送受信をjsonで行う
app.use(express.json());

//許可するipアドレスの設定
// 許可するIPアドレスのリスト-----ローカルホストとドメインサーバのipを入れる
const allowedIps = ["123.45.67.89", "::1"];

app.use((req, res, next) => {
  const clientIp = req.ip.replace("::ffff:", ""); // IPv4/IPv6混在対応
  if (allowedIps.includes(clientIp)) {
    next(); // 許可
  } else {
    res.status(403).send("Access Denied");
  }
});

//アクセス時に最初に開く画面
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "html", "main.html"));
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
      "サーバ側でエラーが発生しました。早急に管理者にご連絡ください。また管理者から連絡がくるまでシステムの利用はご遠慮ください。"
    );
}

//サーバの起動
app.listen(PORT, () => {
  console.log("サーバが起動---starting server");
});
