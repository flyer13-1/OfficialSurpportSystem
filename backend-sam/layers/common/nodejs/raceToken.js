import { createHmac, timingSafeEqual } from "node:crypto";
import { SSMClient, GetParameterCommand } from "@aws-sdk/client-ssm";
import { response, getRaceIdHeader } from "/opt/nodejs/dynamodb.js";

/**
 * raceId トークン（署名付き）の発行・検証。
 * 設計: doc/IF/raceIdToken.md
 *
 * 対象は一般利用者向けAPIのみ（conform / pitlog の入力・参照・出力 / init /
 * POST /entries/start-driver）。管理者向けAPIは対象外（requireAdmin とサーキット
 * 照合で既に安全性を担保しているため。raceIdToken.md §9）。
 */

const ssmClient = new SSMClient({
  region: process.env.AWS_REGION || "ap-northeast-1",
});

// コールドスタート間でキャッシュする（§6。呼び出しのたびにSSMへ取りに行かない）。
let cachedSecret = null;

async function getSecret() {
  if (cachedSecret) return cachedSecret;

  const paramName = process.env.RACE_TOKEN_SECRET_PARAM;
  if (!paramName) {
    throw new Error("RACE_TOKEN_SECRET_PARAM が設定されていません");
  }

  const result = await ssmClient.send(
    new GetParameterCommand({ Name: paramName, WithDecryption: true })
  );
  cachedSecret = result.Parameter.Value;
  return cachedSecret;
}

function sign(payloadB64, secret) {
  return createHmac("sha256", secret).update(payloadB64).digest("base64url");
}

/**
 * raceId トークンを発行する（§3・§4）。
 * @param {{ raceId: string, sub: string, exp: number }} payload exp は UNIX秒
 * @returns {Promise<string>} "中身(Base64URL).署名(Base64URL)" 形式のトークン文字列
 */
export async function issueRaceToken({ raceId, sub, exp }) {
  const secret = await getSecret();
  const payloadB64 = Buffer.from(JSON.stringify({ raceId, sub, exp })).toString(
    "base64url"
  );
  const signatureB64 = sign(payloadB64, secret);
  return `${payloadB64}.${signatureB64}`;
}

/**
 * raceId トークンを検証する（§5）。
 * 失敗理由（偽造・他人・期限切れ）はレスポンスでは区別しない方針のため、
 * 呼び出し側は戻り値の `error` の種類にかかわらず同じエラーレスポンスにすること。
 * ログ用にのみ `error` を区別して残してよい。
 *
 * @param {string} token "中身.署名" 形式のトークン文字列（X-Race-Id ヘッダーの値）
 * @param {string} callerSub authorizer.sub（Cognitoの利用者識別子）
 * @returns {Promise<{ raceId: string } | { error: "invalid" | "expired" }>}
 */
export async function verifyRaceToken(token, callerSub) {
  if (!token || typeof token !== "string" || !token.includes(".")) {
    return { error: "invalid" };
  }

  const [payloadB64, signatureB64] = token.split(".");
  if (!payloadB64 || !signatureB64) {
    return { error: "invalid" };
  }

  const secret = await getSecret();
  const expectedB64 = sign(payloadB64, secret);

  // 長さが違う場合は timingSafeEqual が例外を投げるため、先に弾く
  // （全て同じ形式の署名なので、長さの違いは攻撃の手がかりにならない）。
  const received = Buffer.from(signatureB64);
  const expected = Buffer.from(expectedB64);
  if (received.length !== expected.length || !timingSafeEqual(received, expected)) {
    return { error: "invalid" };
  }

  let payload;
  try {
    payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf-8"));
  } catch {
    return { error: "invalid" };
  }

  if (payload.sub !== callerSub) {
    return { error: "invalid" };
  }
  if (!payload.exp || Math.floor(Date.now() / 1000) > payload.exp) {
    return { error: "expired" };
  }

  return { raceId: payload.raceId };
}

/**
 * 一般向けAPIの入口。X-Race-Id の raceId トークンを検証し、レースIDを返す。
 * 終了済み（exp 超過）は 403 + reason race_finished（04章§3.4）。それ以外の不正は理由を返さない（§5）。
 *
 * @returns {Promise<{ raceId: string } | { error: object }>}
 */
export async function requireGeneralRace(event) {
  const result = await verifyRaceToken(
    getRaceIdHeader(event),
    event.requestContext?.authorizer?.sub
  );
  if (result.error === "expired") {
    return { error: response(403, { msg: "終了したレースです", reason: "race_finished" }) };
  }
  if (result.error) {
    return { error: response(403, { msg: "大会IDを確認できません。入室し直してください" }) };
  }
  return { raceId: result.raceId };
}
