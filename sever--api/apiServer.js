//最初の宣言
const express = require("express");
const mysql = require("mysql");
const path = require("path");
const cors = require("cors");
const app = express();
const PORT = 9000;
const allowedIps = "http://localhost:8080";

//jsonでデータの送受信をする
app.use(express.json());

// Webサーバからのアクセスを許可
app.use(
  cors({
    origin: allowedIps, // 許可するオリジン
    methods: ["GET", "POST", "PUT", "DELETE"], // 許可するHTTPメソッド
    credentials: true, // クッキーを使う場合は true
  })
);

app.use((req, res, next) => {
  const Origin = req.get("Origin");
  if (Origin !== allowedIps) {
    return res.sendStatus(403);
  }
  next();
});

app.listen(PORT, () => {
  console.log("API running on port 4000");
});
