import Fastify from "fastify";
import chalk from "chalk";
import fs from "fs";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";
import { createRequire } from "module";
import dotenv from "dotenv";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import fastifyStatic from "@fastify/static";
import fastifyFormbody from "@fastify/formbody";
import { WebSocketServer } from "ws";
import { createApiKeyMiddleware } from './src/middleware/apikey.js';

const nodeVersion = process.versions.node.split(".")[0];
if (Number.parseInt(nodeVersion) < 20) {
  console.error("\x1b[31m%s\x1b[0m", "╔════════════════════════════════════════════════════════╗");
  console.error("\x1b[31m%s\x1b[0m", "║                   ERROR: NODE.JS VERSION               ║");
  console.error("\x1b[31m%s\x1b[0m", "╚════════════════════════════════════════════════════════╝");
  console.error("\x1b[31m%s\x1b[0m", `[ERROR] You are using Node.js v${process.versions.node}`);
  console.error("\x1b[31m%s\x1b[0m", "[ERROR] Raol-UI requires Node.js v20 or higher to run properly");
  console.error("\x1b[31m%s\x1b[0m", "[ERROR] Please update your Node.js installation and try again");
  console.error("\x1b[31m%s\x1b[0m", "[ERROR] Visit https://nodejs.org to download the latest version");
  console.error("\x1b[31m%s\x1b[0m", "╔════════════════════════════════════════════════════════╗");
  console.error("\x1b[31m%s\x1b[0m", "║                  SHUTTING DOWN...                      ║");
  console.error("\x1b[31m%s\x1b[0m", "╚════════════════════════════════════════════════════════╝");
  process.exit(1);
}

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const require = createRequire(import.meta.url);

const app = Fastify({ 
  trustProxy: true,
  jsonShorthand: false 
});

let PORT = process.env.PORT || 3000;

const formatDate2 = (timestamp) => {
  if (!timestamp) return '-';
  return new Date(timestamp).toLocaleDateString('id-ID', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
};

function calculateLevelProgress(exp, nextLevelExp) {
  if (!nextLevelExp || nextLevelExp === 0) return 0;
  return Math.min(100, Math.floor((exp / nextLevelExp) * 100));
}

function formatNumber(num) {
  if (!num && num !== 0) return '0';
  if (num >= 1000000) return (num / 1000000).toFixed(1) + 'Jt';
  if (num >= 1000) return (num / 1000).toFixed(1) + 'Rb';
  return num.toString();
}

function formatDate(timestamp) {
  if (!timestamp) return 'Tidak diketahui';
  const date = new Date(timestamp);
  const now = new Date();
  const diff = now - date;
  const diffDays = Math.floor(diff / (1000 * 60 * 60 * 24));
  const diffHours = Math.floor(diff / (1000 * 60 * 60));
  const diffMinutes = Math.floor(diff / (1000 * 60));
  if (diffMinutes < 1) return 'Baru saja';
  if (diffMinutes < 60) return `${diffMinutes} menit lalu`;
  if (diffHours < 24) return `${diffHours} jam lalu`;
  if (diffDays < 7) return `${diffDays} hari lalu`;
  return date.toLocaleDateString('id-ID', { 
    day: 'numeric', 
    month: 'long', 
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function formatDuration(ms) {
  if (!ms) return '0 menit';
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  if (days > 0) return `${days} hari ${hours % 24} jam`;
  if (hours > 0) return `${hours} jam ${minutes % 60} menit`;
  if (minutes > 0) return `${minutes} menit`;
  return `${seconds} detik`;
}

app.addHook('onResponse', async (request, reply) => {
  const duration = reply.elapsedTime;
  const clientIp = request.headers['x-real-ip'] || 
                   request.headers['x-forwarded-for']?.split(',')[0]?.trim() || 
                   request.headers['cf-connecting-ip'] || 
                   request.ip || 
                   'unknown';
  const logData = {
    timestamp: new Date().toISOString(),
    method: request.method,
    path: request.url,
    status: reply.statusCode,
    duration: `${Math.round(duration)}ms`,
    ip: clientIp,
    userAgent: request.headers['user-agent']?.substring(0, 100) || 'none'
  };
  if (Object.keys(request.query).length > 0) {
    logData.query = { ...request.query };
    if (logData.query.apikey) logData.query.apikey = '***REDACTED***';
  }
  if (request.body && typeof request.body === 'object' && Object.keys(request.body).length > 0) {
    const bodyCopy = { ...request.body };
    if (bodyCopy.apikey) bodyCopy.apikey = '***REDACTED***';
    if (bodyCopy.password) bodyCopy.password = '***REDACTED***';
    if (bodyCopy.token) bodyCopy.token = '***REDACTED***';
    logData.body = bodyCopy;
  }
  const logLevel = reply.statusCode >= 500 ? 'ERROR' : 
                   reply.statusCode >= 400 ? 'WARN' : 'INFO';
  console.log(JSON.stringify({
    level: logLevel,
    ...logData
  }));
});

app.addHook('onSend', async (request, reply, payload) => {
  reply.header("X-Content-Type-Options", "nosniff");
  reply.header("X-Frame-Options", "DENY");
  reply.header("X-XSS-Protection", "1; mode=block");
  reply.header("Referrer-Policy", "strict-origin-when-cross-origin");
  return payload;
});

const getClientIP = (request) => {
  return request.headers['x-real-ip'] || 
         request.headers['x-forwarded-for']?.split(',')[0]?.trim() || 
         request.headers['cf-connecting-ip'] ||
         request.ip || 
         'unknown';
};

const allowedIPs = [
  "140.213.14.239",
  "172.70.108.82",
  "36.69.156.156",
  "36.69.150.176",
  "114.10.77.217",
  "114.10.78.217",
  "176.118.198.142",
  "::1"
];

const personalAgents = [
  'AsumaBot', 'Firefox', 'Asuma-API-Client', 'HeadlessChrome', 'MyCustomBot', 'ChatGPT-User', 'ClaudeBot', 'DeepSeek', 'Gemini-Bot', 'Copilot', 'PerplexityBot', 'WhatsApp', 'WhatsApp/2.0', 'WhatsApp-Web', 'TelegramBot', 'Telegram-Client', 'DiscordBot', 'Signal-Bot', 'LineBot', 'CloudflareObservatory', 'WeChatBot', 'Googlebot', 'Google', 'Googlebot-Image', 'Googlebot-News', 'Googlebot-Video', 'Googlebot-Mobile', 'Googlebot-Desktop', 'Googlebot-Smartphone', 'Google-InspectionTool', 'Google-PageSpeed', 'Google-Publisher-Plugin', 'Google-Site-Verification', 'Google-Read-Aloud', 'Google-Cloud-Functions', 'Google-AppEngine', 'AdsBot-Google', 'AdsBot-Google-Mobile', 'Mediapartners-Google', 'Google-AMP', 'Google-AMPHTML', 'Google-Translate', 'Google-Web-RedBot', 'Google-Safety', 'APIs-Google', 'Feedfetcher-Google', 'Googlebot-Testing', 'Google-Favicon', 'FacebookBot', 'FacebookExternalHit', 'Facebookcatalog', 'Twitterbot', 'Twitter-Mobile', 'LinkedInBot', 'PinterestBot', 'InstagramBot', 'TikTokBot', 'SnapchatBot', 'Discordbot', 'Slackbot', 'TeamsBot', 'Bingbot', 'BingPreview', 'BingMobile', 'msnbot', 'msnbot-media', 'Yahoo! Slurp', 'Yahoo! Slurp China', 'YandexBot', 'YandexMobileBot', 'YandexImages', 'YandexVideo', 'YandexNews', 'Baiduspider', 'BaiduMobile', 'Baiduspider-image', 'DuckDuckBot', 'DuckDuckGo-Favicons-Bot', 'Sogou web spider', 'Sogou Mobile Spider', 'Sogou News Spider', 'Exabot', 'Exabot-Thumbnails', 'Facebot', 'Applebot', 'Applebot-Mobile', 'AppleNewsBot', 'SeznamBot', 'SeznamBot-Mobile', 'SeznamNewsBot', 'AhrefsBot', 'AhrefsSiteAudit', 'SemrushBot', 'SemrushBot-BA', 'MozBot', 'MozMobileBot', 'MajesticBot', 'Majestic-SEO', 'SEOkicks-Robot', 'Screaming Frog SEO Spider', 'SiteAuditBot', 'GTmetrix', 'PingdomBot', 'PingdomTiers', 'WebPageTest', 'Lighthouse', 'Google-PageSpeed-Insights', 'FeedBurner', 'RSS-Bot', 'FeedlyBot', 'FeedlyBot-Mobile', 'NewsBlur', 'Inoreader', 'TheOldReader', 'Wayback Machine', 'Wayback Save Page', 'Archive.org Bot', 'archive.org_bot', 'InternetArchiveBot', 'IA Archiver', 'Backup-Bot', 'ScreenReader', 'JAWS-Bot', 'NVDA-Bot', 'VoiceOver-Bot', 'ReadAloudBot', 'AlexaBot', 'Amazon-Rekognition', 'GoogleHomeBot', 'Google-Assistant', 'SiriBot', 'CortanaBot', 'BixbyBot', 'YouTubeBot', 'YouTube-Mobile', 'VimeoBot', 'TwitchBot', 'SpotifyBot', 'NetflixBot', 'HuluBot', 'DisneyPlusBot', 'Cloudflare-Bot', 'Cloudflare-Pages', 'Cloudflare-AMP', 'AWS-Lambda', 'AWS-CloudFront', 'AWS-S3', 'AzureBot', 'Azure-Cloud', 'Google-Cloud', 'UptimeBot', 'UptimeRobot', 'PingBot', 'Pingdom', 'StatusCake', 'BetterStack', 'BetterUptime', 'Datadog-Agent', 'NewRelic-Bot', 'NewRelicPinger', 'Dynatrace', 'Site24x7', 'CheckHost', 'Cloudflare-SSL', 'LetEncrypt-Bot', 'Let’s Encrypt', 'HSTS-Bot', 'SecurityScanner', 'WPScan', 'Sucuri', 'SucuriBot', 'Acunetix', 'Netsparker', 'Vercel-bot', 'Vercel-Screenshot', 'Vercel-Favicon', 'Vercel-Edge', 'Vercel-Serverless', 'Vercel-Preview', 'Vercel-Web-Analytics', 'Vercel-Page-Speed'
];

const crawlers = require('crawler-user-agents');
const PROTECTION_ENABLED = true;
const apiPatterns = ['/api/', '/v1/', '/v2/', '/v3/', '/docs/', '/docs', '/'];

app.addHook('onRequest', async (request, reply) => {
  if (!PROTECTION_ENABLED) return;
  const requestPath = request.url;
  const isApiEndpoint = apiPatterns.some(pattern => requestPath.startsWith(pattern));
  if (!isApiEndpoint) return;
  const clientIP = request.headers['x-forwarded-for']?.split(',')[0]?.trim() || 
                   request.headers['x-real-ip'] ||
                   request.ip || 
                   request.socket.remoteAddress;
  const cleanIP = clientIP.replace(/:\d+$/, '');
  const userAgent = request.headers['user-agent'] || '';
  if (allowedIPs.includes(cleanIP)) return;
  const isPersonalAgent = personalAgents.some(agent => 
    userAgent.toLowerCase().includes(agent.toLowerCase())
  );
  if (isPersonalAgent) return;
  const isCrawler = crawlers.some(crawler => {
    try {
      return new RegExp(crawler.pattern, 'i').test(userAgent);
    } catch (e) {
      return false;
    }
  });
  reply.code(403).send('Forbidden');
});

app.addHook('onRequest', async (request, reply) => {
  request.apiKeyValidated = false;
  request.apiKey = null;
  request.apiKeyConfig = null;
});

app.addHook('onRequest', async (request, reply) => {
  const protectedPrefixes = ['/api/', '/ai/', '/random/', '/maker/'];
  if (protectedPrefixes.some(p => request.url.startsWith(p))) {
    const middleware = createApiKeyMiddleware();
    await new Promise((resolve, reject) => {
      middleware(request.raw, reply.raw, (err) => {
        if (err) {
          reply.send(err);
          reject(err);
        } else {
          resolve();
        }
      });
    });
  }
});

await app.register(cors, {
  origin: ['https://asuma.my.id', 'http://asuma.my.id', 'https://www.asuma.my.id', 'http://www.asuma.my.id'],
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'], 
  allowedHeaders: ['Content-Type', 'Authorization', 'x-api-key', 'X-API-Key'],
  credentials: false, 
  maxAge: 86400 
});

await app.register(fastifyFormbody);

await app.register(rateLimit, {
  timeWindow: 60 * 1000,
  max: (request, key) => {
    if (request.apiKeyValidated) return 1000000;
    if (request.url.startsWith('/api/v1/')) return 20;
    if (request.url.startsWith('/api/') || request.url.startsWith('/ai/') || request.url.startsWith('/random/') || request.url.startsWith('/v1/') || request.url.startsWith('/v2/') || request.url.startsWith('/maker/')) return 50;
    return 100;
  },
  keyGenerator: getClientIP,
  skip: (request) => {
    if (request.apiKeyValidated) return true;
    const skipPaths = ['/api/settings', '/api/preview-image', '/assets/', '/src/images/', '/page/sponsor.json', '/src/', '/support'];
    return skipPaths.some(p => request.url.startsWith(p));
  },
  errorResponseBuilder: (request, context) => ({
    statusCode: 429,
    error: 'RATE_LIMIT_EXCEEDED',
    message: 'Too many requests from your IP. Please use an API key for higher limits.'
  })
});

await app.register(fastifyStatic, {
  root: path.join(__dirname, "src", "images"),
  prefix: "/src/images",
  decorateReply: false 
});

await app.register(fastifyStatic, {
  root: path.join(__dirname, "publik"),
  prefix: "/publik",
  decorateReply: false 
});

app.get('/src/*', async (request, reply) => {
  if (request.url.match(/\.(jpg|jpeg|png|gif|svg|ico)$/i)) {
    const filePath = path.join(__dirname, request.url);
    if (fs.existsSync(filePath)) {
      return reply.send(fs.readFileSync(filePath));
    }
  }
  return reply.code(403).type('text/html').send(fs.readFileSync(path.join(__dirname, "page", "status", "4xx", "403.html")));
});

app.get("/u", async (request, reply) => reply.redirect("/"));

app.get("/assets/styles.css", async (request, reply) => {
  return reply.type("text/css").header("Cache-Control", "public, max-age=604800").send(fs.readFileSync(path.join(__dirname, "page", "docs", "styles.css")));
});

app.get("/assets/script.js", async (request, reply) => {
  return reply.type("application/javascript").header("Cache-Control", "public, max-age=604800").send(fs.readFileSync(path.join(__dirname, "page", "docs", "script.js")));
});

app.get("/page/sponsor.json", async (request, reply) => {
  try {
    const sponsorData = JSON.parse(fs.readFileSync(path.join(__dirname, "src", "sponsor.json"), "utf-8"));
    return reply.send(sponsorData);
  } catch (error) {
    return reply.code(500).send({ error: "Failed to load sponsor data" });
  }
});

app.get("/api/preview-image", async (request, reply) => {
  const images = [
    { path: path.join(__dirname, "src", "images", "preview.png"), type: "image/png" },
    { path: path.join(__dirname, "src", "images", "banner.jpg"), type: "image/jpeg" },
    { path: path.join(__dirname, "src", "images", "icon.png"), type: "image/png" }
  ];
  for (const img of images) {
    if (fs.existsSync(img.path)) {
      return reply.type(img.type).header("Cache-Control", "public, max-age=86400").send(fs.readFileSync(img.path));
    }
  }
  return reply.code(404).send({ error: "Preview image not found" });
});

app.get("/api/settings", async (request, reply) => {
  try {
    const settings = JSON.parse(fs.readFileSync(path.join(__dirname, "src", "settings.json"), "utf-8"));
    return reply.send(settings);
  } catch (error) {
    return reply.code(500).type('text/html').send(fs.readFileSync(path.join(__dirname, "page", "status", "5xx", "500.html")));
  }
});

app.get("/api/notifications", async (request, reply) => {
  try {
    const notifications = JSON.parse(fs.readFileSync(path.join(__dirname, "src", "notifications.json"), "utf-8"));
    return reply.send(notifications);
  } catch (error) {
    return reply.code(500).type('text/html').send(fs.readFileSync(path.join(__dirname, "page", "status", "5xx", "500.html")));
  }
});

app.get("/support", async (request, reply) => {
  return reply.type('text/html').send(fs.readFileSync(path.join(__dirname, "page", "support.html")));
});

app.addHook('onRequest', async (request, reply) => {
  const blockedPaths = ["/page/", "/src/settings.json", "/src/notifications.json", "/page/styles.css", "/page/script.js"];
  const isBlocked = blockedPaths.some((blocked) => {
    if (blocked.endsWith("/")) return request.url.startsWith(blocked);
    return request.url === blocked;
  });
  if (isBlocked) {
    return reply.code(403).type('text/html').send(fs.readFileSync(path.join(__dirname, "page", "status", "4xx", "403.html")));
  }
});

let settingsCache = null;
let settingsLastModified = 0;

const getSettings = () => {
  const settingsPath = path.join(__dirname, "./src/settings.json");
  try {
    const stats = fs.statSync(settingsPath);
    if (!settingsCache || stats.mtimeMs > settingsLastModified) {
      settingsCache = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
      settingsLastModified = stats.mtimeMs;
    }
    return settingsCache;
  } catch (error) {
    console.error('Error loading settings:', error);
    return null;
  }
};

app.addHook('onSend', async (request, reply, payload) => {
  if (reply.getHeader('content-type')?.includes('application/json')) {
    try {
      let data = typeof payload === 'string' ? JSON.parse(payload) : payload;
      if (data && typeof data === "object") {
        const settings = getSettings();
        data = {
          status: data.status ?? true,
          creator: settings?.apiSettings?.creator || "RaolByte",
          ...data,
        };
        return JSON.stringify(data);
      }
    } catch (e) {}
  }
  return payload;
});

app.addHook('onRequest', async (request, reply) => {
  const settings = getSettings();
  const skipPaths = ["/api/settings", "/assets/", "/src/", "/api/preview-image", "/src/sponsor.json", "/support"];
  const shouldSkip = skipPaths.some((p) => request.url.startsWith(p));
  if (settings?.maintenance?.enabled && !shouldSkip) {
    if (request.url.startsWith("/api/") || request.url.startsWith("/ai/")) {
      return reply.code(503).send({
        status: false,
        error: "Service temporarily unavailable",
        message: "The API is currently under maintenance. Please try again later.",
        maintenance: true,
        creator: settings.apiSettings?.creator || "VGX Team",
      });
    }
    return reply.code(503).type('text/html').send(fs.readFileSync(path.join(__dirname, "page", "status", "maintenance", "maintenance.html")));
  }
});

let totalRoutes = 0;
const apiFolder = path.join(__dirname, "./src/api");

const loadApiRoutes = async () => {
  const subfolders = fs.readdirSync(apiFolder);
  for (const subfolder of subfolders) {
    const subfolderPath = path.join(apiFolder, subfolder);
    if (fs.statSync(subfolderPath).isDirectory()) {
      const files = fs.readdirSync(subfolderPath);
      for (const file of files) {
        const filePath = path.join(subfolderPath, file);
        if (path.extname(file) === ".js") {
          try {
            const module = await import(pathToFileURL(filePath).href);
            const routeHandler = module.default;
            if (typeof routeHandler === "function") {
              routeHandler(app);
              totalRoutes++;
              console.log(chalk.bgHex("#FFFF99").hex("#333").bold(` Loaded Route: ${path.basename(file)} `));
            }
          } catch (error) {
            console.error(`Error loading route ${file}:`, error);
          }
        }
      }
    }
  }
};

await loadApiRoutes();

app.get("/", async (request, reply) => {
  return reply.type('text/html').send(fs.readFileSync(path.join(__dirname, "page", "index.html")));
});

app.get("/e", async (request, reply) => {
  const vercelId = request.headers["x-vercel-id"] || request.headers["x-request-id"] || "sin1::unknown";
  reply.type("text/html; charset=utf-8").header("Cache-Control", "no-store");
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Deployment Paused</title>
  <style>
    body {
      margin: 0;
      height: 100vh;
      background: #000;
      color: #fff;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      display: flex;
      flex-direction: column;
      justify-content: center;
      align-items: center;
      text-align: center;
    }
    .message {
      font-size: 1.25rem;
      font-weight: 400;
      opacity: 0.95;
      margin-bottom: 3rem;
    }
    .id {
      position: fixed;
      bottom: 16px;
      width: 100%;
      font-size: 0.75rem;
      color: #777;
      letter-spacing: 0.2px;
    }
  </style>
</head>
<body>
  <div class="message">This deployment is temporarily paused</div>
  <div class="id">${vercelId}</div>
</body>
</html>`;
});

app.get("/v1/ip", async (request, reply) => {
  return {
    ip: request.ip,
    country: request.headers["x-vercel-ip-country"],
    city: request.headers["x-vercel-ip-city"],
    region: request.headers["x-vercel-ip-region"]
  };
});

app.get("/atmin/dasboard", async (request, reply) => {
  return reply.type('text/html').send(fs.readFileSync(path.join(__dirname, "page", "dasboard.html")));
});

app.get("/assets/dashboard.css", async (request, reply) => {
  return reply.type("text/css").header("Cache-Control", "public, max-age=604800").send(fs.readFileSync(path.join(__dirname, "page", "dashboard.css")));
});

app.get("/assets/dashboard.js", async (request, reply) => {
  return reply.type("application/javascript").header("Cache-Control", "public, max-age=604800").send(fs.readFileSync(path.join(__dirname, "page", "dashboard.js")));
});

const wss = new WebSocketServer({ noServer: true });
wss.on("connection", (ws) => {
  const sendStats = () => {
    ws.send(
      JSON.stringify({
        type: "stats",
        data: {
          totalRequests: Math.floor(Math.random() * 1000) + 500,
          requestsLast5Min: Math.floor(Math.random() * 50) + 10,
          timestamp: new Date().toISOString()
        }
      })
    );
  };
  const interval = setInterval(sendStats, 5000);
  ws.on("close", () => clearInterval(interval));
});

app.server.on("upgrade", (req, socket, head) => {
  if (req.url === "/admin/stats/ws") {
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit("connection", ws, req);
    });
  } else {
    socket.destroy();
  }
});

app.get("/docs/", async (request, reply) => {
  return reply.type('text/html').send(fs.readFileSync(path.join(__dirname, "page", "docs", "index.html")));
});

console.log(chalk.bgHex("#90EE90").hex("#333").bold(" Load Complete! "));
console.log(chalk.bgHex("#90EE90").hex("#333").bold(` Total Routes Loaded: ${totalRoutes} `));

app.setErrorHandler((error, request, reply) => {
  console.error(error.stack);
  const errorLog = {
    timestamp: new Date().toISOString(),
    error: error.message,
    stack: error.stack,
    path: request.url,
    method: request.method,
    ip: request.headers['x-real-ip'] || request.ip,
    userAgent: request.headers['user-agent']
  };
  console.error(JSON.stringify({ level: 'ERROR', ...errorLog }));
  const status = error.statusCode || 500;
  const htmlPaths = {
    400: "page/status/4xx/400.html",
    401: "page/status/4xx/401.html",
    403: "page/status/4xx/403.html",
    404: "page/status/4xx/404.html",
    429: "page/status/4xx/429.html",
    500: "page/status/5xx/500.html"
  };
  const htmlPath = htmlPaths[status] || htmlPaths[500];
  const fullPath = path.join(__dirname, htmlPath);
  if (fs.existsSync(fullPath)) {
    return reply.code(status).type('text/html').send(fs.readFileSync(fullPath));
  }
  return reply.code(status).send({ error: error.message });
});

const startApplication = async () => {
  try {
    let currentPort = PORT;
    while (true) {
      try {
        await app.listen({ port: currentPort, host: '0.0.0.0' });
        console.log(chalk.bgHex("#90EE90").hex("#333").bold(` Server is running on port ${currentPort} `));
        break;
      } catch (err) {
        if (err.code === 'EADDRINUSE') {
          console.log(`Port ${currentPort} is in use, trying ${currentPort + 1}...`);
          currentPort++;
        } else {
          throw err;
        }
      }
    }
    process.on('SIGTERM', () => {
      console.log('SIGTERM received, shutting down gracefully');
      app.close(() => process.exit(0));
    });
    process.on('SIGINT', () => {
      console.log('SIGINT received, shutting down gracefully');
      app.close(() => process.exit(0));
    });
  } catch (error) {
    console.error(chalk.red('❌ Failed to start server:'), error);
    process.exit(1);
  }
};

startApplication();

export default app;