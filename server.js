// SBSB DB 자동 설정 테스트 앱.
// - 방문 수는 Postgres(DATABASE_URL), 직전 방문 버전은 Redis(REDIS_URL)에 저장한다.
// - 둘 다 SBSB가 package.json의 pg·redis 의존성을 보고 서버에 자동으로 띄우고 연결 정보를 넣어 준다.
// - 재배포·롤백해도 숫자가 이어지면 "DB는 고정, 앱만 교체"가 동작하는 것이다.
// 테스트 시나리오에서는 아래 VERSION·COLOR만 바꿔 push한다.
const http = require("node:http");
const os = require("node:os");
const { Pool } = require("pg");
const { createClient } = require("redis");

const VERSION = "v1";
const COLOR = "#0071e3";

// SBSB가 앱에 넣는 연결 변수. 화면에는 "있음/없음"만 보여 주고 값(비밀번호 포함)은 절대 출력하지 않는다.
const CONNECTION_VARIABLES = ["DATABASE_URL", "REDIS_URL", "DB_HOST", "DB_PORT", "DB_USER", "DB_PASSWORD", "DB_NAME"];

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const redis = process.env.REDIS_URL ? createClient({ url: process.env.REDIS_URL }) : null;
redis?.on("error", (error) => console.log(`redis error: ${error.message}`));

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// 테이블은 앱이 시작할 때 직접 만든다 (SBSB는 마이그레이션을 실행하지 않는다).
// SBSB는 DB가 준비된 뒤 앱을 띄우지만, 혹시 몰라 몇 번 다시 시도한다.
async function prepareDatabase() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL이 없습니다. SBSB가 Postgres를 감지했는지 확인하세요.");
  for (let attempt = 1; attempt <= 15; attempt += 1) {
    try {
      await pool.query("CREATE TABLE IF NOT EXISTS visits (id SERIAL PRIMARY KEY, version TEXT NOT NULL, at TIMESTAMPTZ NOT NULL DEFAULT now())");
      if (redis && !redis.isOpen) await redis.connect();
      console.log("database ready");
      return;
    } catch (error) {
      console.log(`waiting for database (${attempt}/15): ${error.message}`);
      await sleep(1_000);
    }
  }
  throw new Error("database did not become ready");
}

// SBSB의 배포 점검(nginx 컨테이너의 wget)이 "/"를 호출하므로, 그 요청은 방문으로 세지 않는다.
const isHealthCheck = (request) => /wget/i.test(request.headers["user-agent"] ?? "");

async function status({ record }) {
  if (record) await pool.query("INSERT INTO visits (version) VALUES ($1)", [VERSION]);
  const { rows } = await pool.query("SELECT count(*)::int AS count, min(at) AS since FROM visits");
  let previousVersion = null;
  if (redis?.isReady) {
    previousVersion = await redis.get("last-version");
    if (record) await redis.set("last-version", VERSION);
  }
  return {
    version: VERSION,
    host: os.hostname(),
    visits: rows[0].count,
    since: rows[0].since,
    redis: redis ? (redis.isReady ? "연결됨" : "연결 안 됨") : "REDIS_URL 없음",
    previousVersion,
    apiKey: process.env.API_KEY ? "설정됨" : "없음",
    variables: Object.fromEntries(CONNECTION_VARIABLES.map((name) => [name, Boolean(process.env[name])])),
  };
}

const escape = (value) => String(value).replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);

const page = (data) => `<!doctype html>
<html lang="ko">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>SBSB DB demo ${escape(data.version)}</title></head>
<body style="margin:0;min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;background:${COLOR};color:#fff;font-family:system-ui,sans-serif;text-align:center;padding:16px">
  <h1 style="font-size:96px;margin:0">${data.visits}</h1>
  <p style="font-size:20px;opacity:.9;margin:0">총 방문 수 (Postgres) · ${escape(data.version)} · ${escape(data.host)}</p>
  <p style="font-size:16px;opacity:.8;margin:0">직전 방문 버전 (Redis): ${escape(data.previousVersion ?? "-")} · Redis ${escape(data.redis)} · API_KEY ${escape(data.apiKey)}</p>
  <p style="font-size:13px;opacity:.7;margin:8px 0 0">받은 연결 변수: ${CONNECTION_VARIABLES.map((name) => `${name} ${data.variables[name] ? "✓" : "✗"}`).join(" · ")}</p>
  <p style="font-size:13px;opacity:.7;margin:0"><a style="color:#fff" href="/api/status">/api/status</a> (JSON, 방문으로 세지 않음)</p>
</body>
</html>`;

const server = http.createServer(async (request, response) => {
  try {
    if (request.url === "/favicon.ico") return response.writeHead(204).end();
    if (request.url === "/api/status") {
      response.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "X-App-Version": VERSION, "Cache-Control": "no-store" });
      return response.end(JSON.stringify(await status({ record: false }), null, 2));
    }
    const data = await status({ record: !isHealthCheck(request) });
    response.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "X-App-Version": VERSION, "Cache-Control": "no-store" });
    response.end(page(data));
  } catch (error) {
    response.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
    response.end(`database error: ${error.message}`);
  }
});

// SBSB 온프레미스 배포 화면의 기본 컨테이너 포트가 8000이다.
const port = Number(process.env.PORT) || 8000;
prepareDatabase()
  .then(() => server.listen(port, () => console.log(`sbsb db demo ${VERSION} listening on ${port}`)))
  .catch((error) => {
    console.error(error.message);
    process.exit(1);
  });

// docker stop(SIGTERM)을 받으면 처리 중인 요청을 마치고 DB 연결을 닫은 뒤 종료 (blue/green 교체 시)
process.on("SIGTERM", () => {
  server.close(async () => {
    await Promise.allSettled([pool.end(), redis?.isOpen ? redis.close() : null]);
    process.exit(0);
  });
});
