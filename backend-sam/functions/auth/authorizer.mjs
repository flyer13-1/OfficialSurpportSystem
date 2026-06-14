import jwt from "jsonwebtoken";
import { getJwtSecret } from "/opt/nodejs/dynamodb.js";

/**
 * Lambda Authorizer
 * Authorization: Bearer <token> を検証し IAM ポリシーを返す
 */
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

    const decoded = jwt.verify(token, await getJwtSecret());

    // 許可リソースは「API+ステージ全体」のワイルドカードにする。
    // メソッド固有の methodArn を返すと、Authorizer キャッシュ(既定300秒)が
    // 同一トークンの別メソッドに再利用されて 403 になるため。
    const policy = generatePolicy(decoded.username, "Allow", wildcardResource(event.methodArn));
    // 後続 Lambda で使える context
    policy.context = {
      username:        decoded.username,
      organization_id: String(decoded.organization_id),
    };
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
