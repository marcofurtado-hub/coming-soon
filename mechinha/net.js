// Conexão com o "servidor": WebSocket quando servido pelo Node, ou uma
// sala local rodando no próprio navegador (build estático — solo com bots).
const Net = (() => {
  let ws = null;
  let localRoom = null;
  let localPlayer = null;
  const handlers = {};

  const isStatic =
    location.protocol === 'file:' ||
    location.hostname.endsWith('github.io') ||
    new URLSearchParams(location.search).has('solo');

  // socket falso: entrega as mensagens do "servidor" local aos handlers
  const fakeSock = {
    readyState: 1,
    send: raw => {
      const m = JSON.parse(raw);
      setTimeout(() => { if (handlers[m.t]) handlers[m.t](m); }, 0);
    },
  };

  function connect(onOpen) {
    if (isStatic) {
      localRoom = new MechServer.Room('SOLO', () => {});
      setTimeout(onOpen, 0);
      return;
    }
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    ws = new WebSocket(`${proto}://${location.host}`);
    ws.onopen = () => onOpen && onOpen();
    ws.onmessage = ev => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch { return; }
      if (handlers[msg.t]) handlers[msg.t](msg);
    };
    ws.onclose = () => {
      if (handlers._close) handlers._close();
    };
  }

  function send(obj) {
    if (localRoom) {
      if (obj.t === 'join') {
        localPlayer = localRoom.addHuman(String(obj.name || 'Jogador').slice(0, 16), fakeSock);
        return;
      }
      if (localPlayer) localRoom.handleMessage(localPlayer, obj);
      return;
    }
    if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj));
  }

  function on(type, fn) { handlers[type] = fn; }
  function isLocal() { return !!localRoom; }

  return { connect, send, on, isLocal };
})();
