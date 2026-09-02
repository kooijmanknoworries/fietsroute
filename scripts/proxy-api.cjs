// Simple HTTP proxy: forwards all requests to the fietsroute nginx server.
const http = require('http');

const TARGET = process.env.PROXY_TARGET || 'http://127.0.0.1:8080';
const PORT = parseInt(process.env.PROXY_PORT || '8012', 10);

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const options = {
    hostname: new URL(TARGET).hostname,
    port: new URL(TARGET).port,
    path: url.pathname + url.search,
    method: req.method,
    headers: {
      ...req.headers,
      host: req.headers.host || 'localhost',
      'x-forwarded-for': req.socket.remoteAddress || '',
      'x-forwarded-proto': 'http',
    },
  };

  const proxyReq = http.request(options, (proxyRes) => {
    res.writeHead(proxyRes.statusCode, proxyRes.headers);
    proxyRes.pipe(res, { end: true });
  });

  proxyReq.on('error', (err) => {
    console.error('Proxy error:', err.message);
    if (!res.headersSent) {
      res.writeHead(502, { 'content-type': 'text/plain' });
      res.end('Bad Gateway: ' + err.message);
    }
  });

  req.pipe(proxyReq, { end: true });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Proxy listening on 0.0.0.0:${PORT} → ${TARGET}`);
});

// Graceful shutdown
process.on('SIGTERM', () => server.close());
process.on('SIGINT', () => server.close());
