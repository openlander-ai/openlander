const http = require('http');

http
  .get('http://nonexistent-host-12345:8080', () => {})
  .on('error', (e) => {
    console.error(e.message);
    process.exit(1);
  });
