import crypto from "node:crypto";
export const JWT_SECRET = "sim-jwt-secret-sim-jwt-secret-sim-jwt-secret-0123456789";
const b64u = (b) => Buffer.from(b).toString("base64url");
export function signJwt(payload) {
  const head = b64u(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = b64u(JSON.stringify(payload));
  const sig = crypto.createHmac("sha256", JWT_SECRET).update(`${head}.${body}`).digest("base64url");
  return `${head}.${body}.${sig}`;
}
