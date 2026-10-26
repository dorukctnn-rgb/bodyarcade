// Local TURN (UDP) for the live suite, with fault injection.
// node tests/live/support/turn-server.cjs <ip> <udpPort> <controlPort>
// control: http://127.0.0.1:<controlPort>/loss?p=0.1 · /blackhole?on=1 · /stats
// Wraps dgram's send so the relay can drop packets on command; Chrome's WebRTC traffic through it is real.
const dgram = require('dgram');
const http = require('http');
const [ip = '127.0.0.1', udpPort = '3478', ctlPort = '3479'] = process.argv.slice(2);
const chaos = { loss: 0, blackhole: false, sent: 0, dropped: 0 };
const origSend = dgram.Socket.prototype.send;
dgram.Socket.prototype.send = function (...args) {
  if (chaos.blackhole || (chaos.loss > 0 && Math.random() < chaos.loss)) {
    chaos.dropped++;
    const cb = args.find((a) => typeof a === 'function');
    if (cb) process.nextTick(cb, null, 0);
    return;
  }
  chaos.sent++;
  return origSend.apply(this, args);
};
const Turn = require('node-turn');
const server = new Turn({
  listeningPort: Number(udpPort), listeningIps: [ip], relayIps: [ip], minPort: 40000 + (Number(udpPort) % 1000) * 20, maxPort: 40000 + (Number(udpPort) % 1000) * 20 + 19,
  authMech: 'long-term', credentials: { ba: 'ba-secret' }, realm: 'bodyarcade.test', debugLevel: 'ERROR',
});
server.start();
http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname === '/loss') chaos.loss = Number(u.searchParams.get('p')) || 0;
  if (u.pathname === '/blackhole') chaos.blackhole = u.searchParams.get('on') === '1';
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(chaos));
}).listen(Number(ctlPort), '127.0.0.1', () => console.log(`TURN on ${ip}:${udpPort}/udp, control on 127.0.0.1:${ctlPort}`));
