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
import { handler as registerHandler }       from "../functions/auth/register.mjs";
import { handler as conformHandler }        from "../functions/auth/conform.mjs";
import { handler as profileHandler }        from "../functions/auth/profile.mjs";
import { handler as initHandler }           from "../functions/entry/init.mjs";
import { handler as autoCreateHandler }     from "../functions/pitlog/autoCreate.mjs";
import { handler as handCreateHandler }     from "../functions/pitlog/handCreate.mjs";
import { handler as updateGetHandler }      from "../functions/pitlog/updateGet.mjs";
import { handler as updatePutHandler }      from "../functions/pitlog/updatePut.mjs";
import { handler as retireGetHandler }      from "../functions/pitlog/retireGet.mjs";
import { handler as retireCreateHandler }   from "../functions/pitlog/retireCreate.mjs";
import { handler as showAllHandler }        from "../functions/pitlog/showAll.mjs";
import { handler as raceListHandler }        from "../functions/race/list.mjs";
import { handler as raceCreateHandler }      from "../functions/race/create.mjs";
import { handler as raceUpdateHandler }      from "../functions/race/update.mjs";
import { handler as raceDeleteHandler }      from "../functions/race/delete.mjs";

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// ── CORS ──
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin",  "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type,Authorization,X-Race-Id");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

// ── API Gateway イベント生成ヘルパー ──
function makeEvent(req, authorizer = null) {
  return {
    httpMethod:           req.method,
    path:                 req.path,
    pathParameters:       req.params && Object.keys(req.params).length ? req.params : null,
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
    // ローカルは Cognito の代わりに自前 JWT(JWT_SECRET) を検証する。
    // 本番の Lambda Authorizer(authorizer.mjs) と同じく leader グループ所属を
    // 管理者とみなす。API Gateway は context 値を文字列化して後続へ渡すため、
    // ここでも "true"/"false" の文字列に揃える（profile.mjs / admin.js が "true" 比較）。
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const groups  = decoded["cognito:groups"] || decoded.groups || [];
    req.authorizer = {
      username:        decoded.username,
      organization_id: String(decoded.organization_id),
      isAdmin:         String(groups.includes("leader")),
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

// ── ローカル専用: 開発用トークン発行 ──
// 本番は Cognito がトークンを発行するため存在しない。ローカルで認証付き API を
// 叩くための JWT を手軽に得るためのエンドポイント。groups に "leader" を入れると
// 管理者(admin API)として扱われる。
// 例) curl -X POST localhost:3000/dev/token -H "Content-Type: application/json" \
//        -d '{"username":"じんこうちのう","organization_id":1,"groups":["leader"]}'
app.post("/dev/token", (req, res) => {
  const { username, organization_id = 1, groups = [] } = req.body || {};
  if (!username) return res.status(400).json({ msg: "username は必須です" });
  const token = jwt.sign(
    { username, organization_id, "cognito:groups": groups },
    process.env.JWT_SECRET,
    { expiresIn: "12h" },
  );
  res.json({ token });
});

// ── 認証不要 ──
// ログイン(POST /login)・パスワード変更(POST /user/password)は Cognito へ移行し廃止。
app.post("/user",          (req, res) => handle(registerHandler,        req, res));

// ── 認証必要 ──
app.post("/user/me",       auth, (req, res) => handle(conformHandler,        req, res, true));
app.get ("/user/me",       auth, (req, res) => handle(profileHandler,         req, res, true));

app.get ("/entries/init",   auth, (req, res) => handle(initHandler,           req, res, true));
app.post("/entries/auto",   auth, (req, res) => handle(autoCreateHandler,      req, res, true));
app.post("/entries/hand",   auth, (req, res) => handle(handCreateHandler,      req, res, true));
app.get ("/entries/update", auth, (req, res) => handle(updateGetHandler,       req, res, true));
app.put ("/entries/update", auth, (req, res) => handle(updatePutHandler,       req, res, true));
app.get ("/entries/retire", auth, (req, res) => handle(retireGetHandler,       req, res, true));
app.post("/entries/retire", auth, (req, res) => handle(retireCreateHandler,    req, res, true));
app.get ("/entries/show",   auth, (req, res) => handle(showAllHandler,         req, res, true));

// ── 管理者画面（一次情報CRUD）──
app.get   ("/race",      auth, (req, res) => handle(raceListHandler,   req, res, true));
app.post  ("/race",      auth, (req, res) => handle(raceCreateHandler, req, res, true));
app.put   ("/race",      auth, (req, res) => handle(raceUpdateHandler, req, res, true));
app.delete("/race/:id",  auth, (req, res) => handle(raceDeleteHandler, req, res, true));

// ── 起動 ──
app.listen(PORT, () => {
  console.log(`\n✅ ローカルサーバー起動: http://localhost:${PORT}`);
  console.log("──────────────────────────────────");
  console.log("  POST /dev/token         認証不要（ローカル専用・開発用トークン発行）");
  console.log("  POST /user              認証不要");
  console.log("  POST /user/me           JWT必要");
  console.log("  GET  /user/me           JWT必要");
  console.log("  GET  /entries/init      JWT必要 ?race_id=...");
  console.log("  POST /entries/auto      JWT必要 ?race_id=...");
  console.log("  POST /entries/hand      JWT必要 ?race_id=...");
  console.log("  GET  /entries/update    JWT必要 ?race_id=...&carNum=...");
  console.log("  PUT  /entries/update    JWT必要 ?race_id=...");
  console.log("  GET  /entries/retire    JWT必要 ?race_id=...");
  console.log("  POST /entries/retire    JWT必要 ?race_id=...");
  console.log("  GET  /entries/show      JWT必要 ?race_id=...");
  console.log("  GET  /race              JWT必要 admin（レース一覧）");
  console.log("  POST /race              JWT必要 admin（レース登録）");
  console.log("  PUT  /race              JWT必要 admin（レース変更）");
  console.log("  DELETE /race/:id        JWT必要 admin（レース削除）");
  console.log("──────────────────────────────────\n");
});
