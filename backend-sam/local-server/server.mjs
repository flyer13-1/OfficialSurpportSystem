/**
 * ローカル開発サーバー（Express.js）
 * sam local start-api の代替
 *
 * 起動: start-local.bat
 * URL:  http://localhost:3000
 *
 * 前提: .env.local が backend-sam/ 直下に存在すること
 *      （.env.local.example をコピーして設定）
 */

import { createRequire } from "module";
import { fileURLToPath } from "url";
import { resolve, dirname } from "path";

// dotenv を require で読む（ESM 環境での workaround）
const require = createRequire(import.meta.url);
const dotenv  = require("dotenv");
dotenv.config({ path: resolve(dirname(fileURLToPath(import.meta.url)), "../.env.local") });

import express from "express";
import jwt     from "jsonwebtoken";

// ── Lambda ハンドラーをインポート ──
import { handler as loginHandler }          from "../functions/auth/login.mjs";
import { handler as registerHandler }       from "../functions/auth/register.mjs";
import { handler as conformHandler }        from "../functions/auth/conform.mjs";
import { handler as profileHandler }        from "../functions/auth/profile.mjs";
import { handler as changePasswordHandler } from "../functions/auth/changePassword.mjs";
import { handler as initHandler }           from "../functions/entry/init.mjs";
import { handler as autoCreateHandler }     from "../functions/pitlog/autoCreate.mjs";
import { handler as handCreateHandler }     from "../functions/pitlog/handCreate.mjs";
import { handler as updateGetHandler }      from "../functions/pitlog/updateGet.mjs";
import { handler as updatePutHandler }      from "../functions/pitlog/updatePut.mjs";
import { handler as retireGetHandler }      from "../functions/pitlog/retireGet.mjs";
import { handler as retireCreateHandler }   from "../functions/pitlog/retireCreate.mjs";
import { handler as showAllHandler }        from "../functions/pitlog/showAll.mjs";

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// ── CORS ──
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin",  "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type,Authorization");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

// ── API Gateway イベント生成ヘルパー ──
function makeEvent(req, authorizer = null) {
  return {
    httpMethod:           req.method,
    path:                 req.path,
    queryStringParameters: req.query || null,
    headers:              req.headers,
    body:                 req.body ? JSON.stringify(req.body) : null,
    requestContext: {
      authorizer: authorizer || {},
    },
  };
}

// ── JWT 検証ミドルウェア ──
function auth(req, res, next) {
  const authHeader = req.headers["authorization"] || "";
  const token      = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!token) {
    return res.status(401).json({ msg: "認証が必要です（Authorizationヘッダーを確認してください）" });
  }
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.authorizer = {
      username:        decoded.username,
      organization_id: String(decoded.organization_id),
    };
    next();
  } catch {
    return res.status(401).json({ msg: "トークンが無効または期限切れです" });
  }
}

// ── Lambda レスポンスをそのまま Express レスポンスに変換 ──
async function handle(handlerFn, req, res, useAuth = false) {
  try {
    const authorizer = useAuth ? req.authorizer : null;
    const event      = makeEvent(req, authorizer);
    const result     = await handlerFn(event);
    return res
      .status(result.statusCode)
      .set(result.headers || {})
      .json(JSON.parse(result.body));
  } catch (err) {
    console.error("Unhandled error:", err);
    return res.status(500).json({ msg: "サーバーエラーが発生しました" });
  }
}

// ===== ルーティング =====

// ── 認証不要 ──
app.post("/login",         (req, res) => handle(loginHandler,          req, res));
app.post("/user",          (req, res) => handle(registerHandler,        req, res));

// ── 認証必要 ──
app.post("/user/me",       auth, (req, res) => handle(conformHandler,        req, res, true));
app.get ("/user/me",       auth, (req, res) => handle(profileHandler,         req, res, true));
app.post("/user/password", auth, (req, res) => handle(changePasswordHandler,  req, res, true));

app.get ("/entries/init",   auth, (req, res) => handle(initHandler,           req, res, true));
app.post("/entries/auto",   auth, (req, res) => handle(autoCreateHandler,      req, res, true));
app.post("/entries/hand",   auth, (req, res) => handle(handCreateHandler,      req, res, true));
app.get ("/entries/update", auth, (req, res) => handle(updateGetHandler,       req, res, true));
app.put ("/entries/update", auth, (req, res) => handle(updatePutHandler,       req, res, true));
app.get ("/entries/retire", auth, (req, res) => handle(retireGetHandler,       req, res, true));
app.post("/entries/retire", auth, (req, res) => handle(retireCreateHandler,    req, res, true));
app.get ("/entries/show",   auth, (req, res) => handle(showAllHandler,         req, res, true));

// ── 起動 ──
app.listen(PORT, () => {
  console.log(`\n✅ ローカルサーバー起動: http://localhost:${PORT}`);
  console.log("──────────────────────────────────");
  console.log("  POST /login             認証不要");
  console.log("  POST /user              認証不要");
  console.log("  POST /user/me           JWT必要");
  console.log("  GET  /user/me           JWT必要");
  console.log("  POST /user/password     JWT必要");
  console.log("  GET  /entries/init      JWT必要 ?race_id=...");
  console.log("  POST /entries/auto      JWT必要 ?race_id=...");
  console.log("  POST /entries/hand      JWT必要 ?race_id=...");
  console.log("  GET  /entries/update    JWT必要 ?race_id=...&carNum=...");
  console.log("  PUT  /entries/update    JWT必要 ?race_id=...");
  console.log("  GET  /entries/retire    JWT必要 ?race_id=...");
  console.log("  POST /entries/retire    JWT必要 ?race_id=...");
  console.log("  GET  /entries/show      JWT必要 ?race_id=...");
  console.log("──────────────────────────────────\n");
});
