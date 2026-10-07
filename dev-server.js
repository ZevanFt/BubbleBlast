// 开发服务器：no-store 禁缓存（改代码刷新即生效）
const http = require('http');
const fs = require('fs');
const path = require('path');
const s = http.createServer((req, res) => {
  const f = decodeURIComponent(req.url.split('?')[0]);
  const file = path.join(process.cwd(), f === '/' ? '/index.html' : f);
  try {
    const d = fs.readFileSync(file);
    const ext = file.split('.').pop();
    const ct = { js: 'text/javascript', css: 'text/css', html: 'text/html', png: 'image/png', svg: 'image/svg+xml' }[ext] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': ct, 'Cache-Control': 'no-store' });
    res.end(d);
  } catch (e) {
    res.writeHead(404);
    res.end('Not found');
  }
});
s.listen(8636, () => console.log('dev server on 8636 (no-cache)'));
