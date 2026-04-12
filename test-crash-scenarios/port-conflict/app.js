const net = require('net');

net.createServer().listen(3000, () => {
  net
    .createServer()
    .listen(3000)
    .on('error', (e) => {
      console.error(e.message);
      process.exit(1);
    });
});
