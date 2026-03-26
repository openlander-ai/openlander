const http = require('http');

http
  .createServer((req, res) => {
    res.writeHead(200);
    res.end('OK');
  })
  .listen(3000, () => console.log('Listening on 3000'));
