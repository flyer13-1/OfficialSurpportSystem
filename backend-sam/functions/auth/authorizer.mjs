import { CognitoJwtVerifier } from "aws-jwt-verify";

/**
 * Lambda Authorizer
 * Authorization: Bearer <token> を検証し IAM ポリシーを返す
 *
 * トークンは Cognito User Pool が発行する ID トークン（フロントは
 * common.js の cognitoPool で認証し、result.getIdToken() を保存・送信する）。
 * 検証は公開鍵(JWKS)で行うため秘密鍵の管理は不要。JWKS はコールド起動間で
 * キャッシュされる（verifier 内部実装）。
 */
const verifier = CognitoJwtVerifier.create({
  userPoolId: process.env.COGNITO_USER_POOL_ID,
  tokenUse: "id",
  clientId: process.env.COGNITO_CLIENT_ID,
});

export const handler = async (event) => {
  try {
    const authHeader =
      event.authorizationToken ||
      event.headers?.Authorization ||
      event.headers?.authorization ||
      "";
    const token = authHeader.replace(/^Bearer\s+/i, "").trim();

    if (!token) {
      return generatePolicy("anonymous", "Deny", event.methodArn);
    }

    const payload = await verifier.verify(token);
    // ID トークンの担当者名は cognito:username クレームに入る
    const username = payload["cognito:username"] || payload.sub;

    // 許可リソースは「API+ステージ全体」のワイルドカードにする。
    // メソッド固有の methodArn を返すと、Authorizer キャッシュ(既定300秒)が
    // 同一トークンの別メソッドに再利用されて 403 になるため。
    const policy = generatePolicy(username, "Allow", wildcardResource(event.methodArn));
    // 後続 Lambda で使える context（所属サーキット・管理者フラグは
    // UsersTable を参照する側で取得する。profile.mjs / admin.js 参照）
    policy.context = { username };
    return policy;
  } catch (err) {
    console.error("Authorizer error:", err.message);
    return generatePolicy("anonymous", "Deny", event.methodArn);
  }
};

// methodArn 例: arn:aws:execute-api:region:acct:apiId/stage/METHOD/resource/path
// → arn:aws:execute-api:region:acct:apiId/stage/* （全メソッド・全パス）に変換
function wildcardResource(methodArn) {
  const parts = methodArn.split("/");
  return `${parts[0]}/${parts[1]}/*`; // {…:apiId}/{stage}/*
}

function generatePolicy(principalId, effect, resource) {
  return {
    principalId,
    policyDocument: {
      Version: "2012-10-17",
      Statement: [
        {
          Action:   "execute-api:Invoke",
          Effect:   effect,
          Resource: resource,
        },
      ],
    },
  };
}
