/**
 * Minimal GitHub webhook → deploy listener. Zero dependencies (Node stdlib).
 * Verifies the HMAC-SHA256 signature, and on a push to DEPLOY_BRANCH runs
 * deploy.sh (serialized — a push during a deploy queues one more run).
 *
 * Env: WEBHOOK_SECRET, WEBHOOK_PORT (default 9000), DEPLOY_BRANCH (default main).
 * GitHub webhook: Payload URL http://<host>:9000/hooks/deploy · content-type
 * application/json · secret = WEBHOOK_SECRET · event = "push".
 */
const http = require("node:http");
const crypto = require("node:crypto");
const { execFile } = require("node:child_process");
const path = require("node:path");

const PORT = Number(process.env.WEBHOOK_PORT || 9000);
const SECRET = process.env.WEBHOOK_SECRET || "";
const BRANCH = process.env.DEPLOY_BRANCH || "main";
const REPO_DIR = path.join(__dirname, "..");
const DEPLOY_SH = path.join(__dirname, "deploy.sh");

let running = false;
let queued = false;

function runDeploy() {
  if (running) { queued = true; return; }
  running = true;
  console.log(new Date().toISOString(), "deploy: start");
  execFile("bash", [DEPLOY_SH], { cwd: REPO_DIR, maxBuffer: 64 * 1024 * 1024 }, (err, stdout, stderr) => {
    if (stdout) process.stdout.write(stdout);
    if (stderr) process.stderr.write(stderr);
    console.log(new Date().toISOString(), "deploy:", err ? `FAILED ${err.message}` : "ok");
    running = false;
    if (queued) { queued = false; runDeploy(); }
  });
}

function verify(sig, body) {
  if (!SECRET || !sig) return false;
  const expected = "sha256=" + crypto.createHmac("sha256", SECRET).update(body).digest("hex");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

http.createServer((req, res) => {
  if (req.method !== "POST" || req.url !== "/hooks/deploy") { res.writeHead(404); return res.end(); }
  const chunks = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", () => {
    const body = Buffer.concat(chunks);
    if (!verify(req.headers["x-hub-signature-256"], body)) { res.writeHead(401); return res.end("bad signature"); }
    const event = req.headers["x-github-event"];
    if (event === "ping") { res.writeHead(200); return res.end("pong"); }
    if (event !== "push") { res.writeHead(204); return res.end(); }
    let ref = "";
    try { ref = JSON.parse(body.toString()).ref; } catch { res.writeHead(400); return res.end("bad json"); }
    if (ref !== `refs/heads/${BRANCH}`) { res.writeHead(200); return res.end(`ignored ${ref}`); }
    res.writeHead(202); res.end("deploying");
    runDeploy();
  });
}).listen(PORT, () => console.log(`webhook on :${PORT} → deploy on push to ${BRANCH}`));
