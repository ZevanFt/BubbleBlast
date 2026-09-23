const http = require('http');
const fs = require('fs');
const s = http.createServer((req, res) => {
  const f = req.url === '/' ? '/index.html' : req.url;
  try {
    const d = fs.readFileSync(process.cwd() + f);
    const ext = f.split('.').pop();
    const ct = ext === 'js' ? 'text/javascript' : ext === 'css' ? 'text/css' : 'text/html';
    res.writeHead(200, {'Content-Type': ct});
    res.end(d);
  } catch(e) {
    res.writeHead(404);
    res.end('Not found');
  }
});
s.listen(9999, () => console.log('Server ok on 9999'));
