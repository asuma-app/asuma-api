import Fastify from "fastify";
import chalk from "chalk";
import fs from "fs";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";
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

const app = Fastify({ 
  trustProxy: true,
  jsonShorthand: false 
});

let PORT = process.env.PORT || 3000;

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

app.addHook('onRequest', async (request, reply) => {
  request.apiKeyValidated = false;
  request.apiKey = null;
  request.apiKeyConfig = null;
});

app.addHook('onRequest', async (request, reply) => {
  const protectedPrefixes = ['/api/'];
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
    return 100;
  },
  keyGenerator: getClientIP,
  skip: (request) => {
    if (request.apiKeyValidated) return true;
    const skipPaths = ['/api/settings', '/api/preview-image', '/api/sponsor.json', '/api/health'];
    return skipPaths.some(p => request.url.startsWith(p));
  },
  errorResponseBuilder: (request, context) => ({
    statusCode: 429,
    status: false,
    error: 'RATE_LIMIT_EXCEEDED',
    message: 'Too many requests from your IP. Please use an API key for higher limits.'
  })
});

await app.register(fastifyStatic, {
  root: path.join(__dirname, "src", "images"),
  prefix: "/api/images",
  decorateReply: false 
});

await app.register(fastifyStatic, {
  root: path.join(__dirname, "publik"),
  prefix: "/api/publik",
  decorateReply: false 
});

app.get("/api", async (request, reply) => {
  const settings = getSettings();
  return reply.code(200).send({
    status: true,
    message: "Welcome to Asuma API",
    creator: settings?.apiSettings?.creator || "DitssCloud",
    version: settings?.version || "1.1.0",
    endpoints: {
      settings: "/api/settings",
      notifications: "/api/notifications",
      sponsor: "/api/sponsor.json",
      preview: "/api/preview-image",
      health: "/api/health",
      ip: "/api/ip",
      docs: "/api/docs",
      support: "/api/support"
    }
  });
});

app.get("/api/u", async (request, reply) => reply.redirect("/api"));

app.get("/api/ip", async (request, reply) => {
  return reply.code(200).send({
    status: true,
    data: {
      ip: request.ip,
      country: request.headers["x-vercel-ip-country"] || null,
      city: request.headers["x-vercel-ip-city"] || null,
      region: request.headers["x-vercel-ip-region"] || null
    }
  });
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
  return reply.code(404).send({ status: false, error: "Preview image not found" });
});

app.get("/api/settings", async (request, reply) => {
  try {
    const settings = JSON.parse(fs.readFileSync(path.join(__dirname, "src", "settings.json"), "utf-8"));
    return reply.code(200).send({ status: true, data: settings });
  } catch (error) {
    return reply.code(500).send({ status: false, error: "Failed to load settings" });
  }
});

app.get("/api/notifications", async (request, reply) => {
  try {
    const notifications = JSON.parse(fs.readFileSync(path.join(__dirname, "src", "notifications.json"), "utf-8"));
    return reply.code(200).send({ status: true, data: notifications });
  } catch (error) {
    return reply.code(500).send({ status: false, error: "Failed to load notifications" });
  }
});

app.get("/api/sponsor.json", async (request, reply) => {
  try {
    const sponsorData = JSON.parse(fs.readFileSync(path.join(__dirname, "src", "sponsor.json"), "utf-8"));
    return reply.code(200).send({ status: true, data: sponsorData });
  } catch (error) {
    return reply.code(500).send({ status: false, error: "Failed to load sponsor data" });
  }
});

app.get("/api/support", async (request, reply) => {
  return reply.code(200).send({
    status: true,
    data: {
      contact: {
        whatsapp: "https://wa.me/6281234567890",
        email: "support@asuma.my.id",
        telegram: "https://t.me/asuma_support"
      },
      documentation: "https://api.asuma.my.id/api/docs",
      business: {
        name: "Ditss Store",
        website: "https://asuma.my.id"
      }
    }
  });
});

app.get("/api/docs", async (request, reply) => {
  const settings = getSettings();
  return reply.code(200).send({
    status: true,
    data: {
      title: "Asuma API Documentation",
      version: settings?.version || "1.1.0",
      base_url: "https://api.asuma.my.id",
      authentication: {
        type: "API Key",
        parameter: "apikey",
        location: "query",
        required: settings?.apiSettings?.requireApikey || false
      },
      endpoints: settings?.categories || [],
      rate_limit: {
        default: "100 requests/minute",
        premium: "Unlimited"
      }
    }
  });
});

app.get("/api/health", async (request, reply) => {
  const settings = getSettings();
  return reply.code(200).send({
    status: true,
    data: {
      service: "Asuma API",
      version: settings?.version || "1.1.0",
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
      maintenance: settings?.maintenance?.enabled || false,
      node_version: process.version
    }
  });
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
      if (data && typeof data === "object" && !data.status) {
        const settings = getSettings();
        data = {
          status: true,
          creator: settings?.apiSettings?.creator || "DitssCloud",
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
  const skipPaths = ["/api/settings", "/api/preview-image", "/api/sponsor.json", "/api/health", "/api/support"];
  const shouldSkip = skipPaths.some((p) => request.url.startsWith(p));
  if (settings?.maintenance?.enabled && !shouldSkip) {
    return reply.code(503).send({
      status: false,
      error: "Service temporarily unavailable",
      message: settings?.maintenance?.message || "The API is currently under maintenance. Please try again later.",
      maintenance: true,
      creator: settings.apiSettings?.creator || "DitssCloud",
    });
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
  if (req.url === "/api/admin/stats/ws") {
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit("connection", ws, req);
    });
  } else {
    socket.destroy();
  }
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
  return reply.code(status).send({
    status: false,
    error: error.message || "Internal Server Error",
    statusCode: status
  });
});

app.setNotFoundHandler((request, reply) => {
  return reply.code(404).send({
    status: false,
    error: "Endpoint not found",
    message: `The endpoint ${request.url} does not exist`,
    statusCode: 404
  });
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
