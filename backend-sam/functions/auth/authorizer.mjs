import jwt from "jsonwebtoken";

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

    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    const policy = generatePolicy(decoded.username, "Allow", event.methodArn);
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
