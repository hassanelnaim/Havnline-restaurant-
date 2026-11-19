// Preloaded into the app under test (NODE_OPTIONS=--require).
// 1. Hosts of paid/external services resolve to the local fakes (127.0.0.1:443).
// 2. Every other outside host fails to resolve, and the container's outbound
//    proxy port is refused, so nothing in a simulation can reach the real
//    Stripe, Twilio, Anthropic, ElevenLabs or Resend — no charges, texts or calls.
const dns = require("dns");
const net = require("net");
const fs = require("fs");
const FAKE = new Set(fs.readFileSync("/home/claude/sim/certs/hosts.txt", "utf8").trim().split(/\s+/));
const LOCAL = /^(localhost|127\.\d+\.\d+\.\d+|::1|0\.0\.0\.0)$/;
const blocked = new Set();
const orig = dns.lookup;
dns.lookup = function (host, opts, cb) {
  if (typeof opts === "function") { cb = opts; opts = {}; }
  if (FAKE.has(host)) return orig.call(dns, "127.0.0.1", opts, cb);
  if (LOCAL.test(host) || net.isIP(host)) return orig.call(dns, host, opts, cb);
  if (!blocked.has(host)) { blocked.add(host); console.warn(`[sim-hook] blocked outbound host ${host}`); }
  const err = new Error(`sim: outbound host blocked: ${host}`);
  err.code = "ENOTFOUND";
  process.nextTick(() => cb(err));
};
const proxyPort = Number((process.env.HTTPS_PROXY || "").split(":").pop()) || 40027;
const origConnect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (...args) {
  const o = typeof args[0] === "object" && args[0] ? args[0] : { port: args[0] };
  if (Number(o.port) === proxyPort) {
    const e = new Error("sim: outbound proxy refused");
    e.code = "ECONNREFUSED";
    process.nextTick(() => this.destroy(e));
    return this;
  }
  return origConnect.apply(this, args);
};
