/**
 * Standalone production server for Expo static builds.
 *
 * Serves the output of build.js (static-build/) with two special routes:
 * - GET / or /manifest with expo-platform header → platform manifest JSON
 * - GET / without expo-platform → landing page HTML
 * Everything else falls through to static file serving from ./static-build/.
 *
 * Zero external dependencies — uses only Node.js built-ins (http, fs, path).
 */

const http = require("http");
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const STATIC_ROOT = path.resolve(__dirname, "..", "static-build");
const TEMPLATE_PATH = path.resolve(__dirname, "templates", "landing-page.html");
const basePath = (process.env.BASE_PATH || "/").replace(/\/+$/, "");

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".map": "application/json",
};

function getAppName() {
  try {
    const appJsonPath = path.resolve(__dirname, "..", "app.json");
    const appJson = JSON.parse(fs.readFileSync(appJsonPath, "utf-8"));
    return appJson.expo?.name || "App Landing Page";
  } catch {
    return "App Landing Page";
  }
}

function serveManifest(platform, res) {
  const manifestPath = path.join(STATIC_ROOT, platform, "manifest.json");

  if (!fs.existsSync(manifestPath)) {
    res.writeHead(404, { "content-type": "application/json" });
    res.end(
      JSON.stringify({ error: `Manifest not found for platform: ${platform}` }),
    );
    return;
  }

  const manifest = fs.readFileSync(manifestPath, "utf-8");
  res.writeHead(200, {
    "content-type": "application/json",
    "expo-protocol-version": "1",
    "expo-sfv-version": "0",
  });
  res.end(manifest);
}

function serveLandingPage(req, res, landingPageTemplate, appName) {
  const forwardedProto = req.headers["x-forwarded-proto"];
  const protocol = forwardedProto || "https";
  const host = req.headers["x-forwarded-host"] || req.headers["host"];
  const baseUrl = `${protocol}://${host}`;
  const expsUrl = `${host}`;

  const html = landingPageTemplate
    .replace(/BASE_URL_PLACEHOLDER/g, baseUrl)
    .replace(/EXPS_URL_PLACEHOLDER/g, expsUrl)
    .replace(/APP_NAME_PLACEHOLDER/g, appName);

  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end(html);
}

// Extensions worth gzipping. The Hermes JS bundle is ~4.3MB raw and ~1MB
// gzipped — on slow mobile connections the uncompressed transfer can stall
// mid-download in Expo Go ("downloading..." stuck at N%), so compression is
// load-bearing here, not just an optimization.
const COMPRESSIBLE = new Set([".js", ".json", ".html", ".css", ".svg", ".map", ".ttf", ".otf"]);

// filePath -> { mtimeMs, gzipped } cache so repeated bundle downloads don't
// re-compress. Build outputs are immutable per timestamp dir, so this stays
// small (a handful of bundles/fonts per deployed build).
const gzipCache = new Map();

function getGzipped(filePath, content, mtimeMs) {
  const cached = gzipCache.get(filePath);
  if (cached && cached.mtimeMs === mtimeMs) return cached.gzipped;
  const gzipped = zlib.gzipSync(content, { level: 6 });
  gzipCache.set(filePath, { mtimeMs, gzipped });
  return gzipped;
}

function serveStaticFile(req, urlPath, res) {
  const safePath = path.normalize(urlPath).replace(/^(\.\.(\/|\\|$))+/, "");
  const filePath = path.join(STATIC_ROOT, safePath);

  if (!filePath.startsWith(STATIC_ROOT)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  let stat;
  try {
    stat = fs.statSync(filePath);
  } catch {
    res.writeHead(404);
    res.end("Not Found");
    return;
  }
  if (stat.isDirectory()) {
    res.writeHead(404);
    res.end("Not Found");
    return;
  }

  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || "application/octet-stream";
  const content = fs.readFileSync(filePath);

  const headers = {
    "content-type": contentType,
    vary: "accept-encoding",
  };

  // Build outputs live under timestamped directories and never change —
  // let clients and the proxy cache them so retries don't re-download.
  if (/^\/\d+-\d+\//.test(safePath.startsWith("/") ? safePath : `/${safePath}`)) {
    headers["cache-control"] = "public, max-age=31536000, immutable";
  }

  const acceptEncoding = String(req.headers["accept-encoding"] || "");
  if (COMPRESSIBLE.has(ext) && /\bgzip\b/.test(acceptEncoding)) {
    const gzipped = getGzipped(filePath, content, stat.mtimeMs);
    headers["content-encoding"] = "gzip";
    headers["content-length"] = gzipped.length;
    res.writeHead(200, headers);
    res.end(gzipped);
    return;
  }

  headers["content-length"] = content.length;
  res.writeHead(200, headers);
  res.end(content);
}

const landingPageTemplate = fs.readFileSync(TEMPLATE_PATH, "utf-8");
const appName = getAppName();

const server = http.createServer((req, res) => {
  // Request logging so deployment logs show what devices actually fetch
  // (manifest, bundle, font assets) — essential for debugging blank-screen
  // reports from Expo Go where we have no client-side logs.
  res.on("finish", () => {
    console.log(
      `${req.method} ${req.url} ${res.statusCode} ua="${req.headers["user-agent"] || ""}" expo-platform="${req.headers["expo-platform"] || ""}"`,
    );
  });

  const url = new URL(req.url || "/", `http://${req.headers.host}`);
  let pathname = url.pathname;

  if (basePath && pathname.startsWith(basePath)) {
    pathname = pathname.slice(basePath.length) || "/";
  }

  if (pathname === "/" || pathname === "/manifest") {
    const platform = req.headers["expo-platform"];
    if (platform === "ios" || platform === "android") {
      return serveManifest(platform, res);
    }

    if (pathname === "/") {
      return serveLandingPage(req, res, landingPageTemplate, appName);
    }
  }

  serveStaticFile(req, pathname, res);
});

const port = parseInt(process.env.PORT || "3000", 10);
server.listen(port, "0.0.0.0", () => {
  console.log(`Serving static Expo build on port ${port}`);
});
