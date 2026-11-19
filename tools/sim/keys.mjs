import { signJwt } from "./gateway-jwt.mjs";
const now = Math.floor(Date.now()/1000), exp = now + 10*365*86400;
console.log("ANON=" + signJwt({ role: "anon", iss: "supabase", iat: now, exp }));
console.log("SERVICE=" + signJwt({ role: "service_role", iss: "supabase", iat: now, exp }));
