'use strict';

const dgram = require('dgram');
const os = require('os');

const DISCOVERY_PORT = 7750;
const PROTOCOL_ID = 'LOCALDROP_V1';
const BEACON_INTERVAL = 3000; // 3 segundos
const PEER_TIMEOUT = 10000;   // 10 segundos

let peers = {}; // Almacena peers descubiertos: { "ip:port": { hostname, ip, port, os, lastSeen } }
let socket = null;
let beaconTimer = null;
let cleanupTimer = null;
let currentAppPort = 7749;

// Obtener la IP local IPv4 no interna
function getLocalIP() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      // Filtrar IPv4 y no internas (127.0.0.1)
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return '127.0.0.1';
}

// Obtener el nombre de OS formateado
function getOSName() {
  const platform = process.platform;
  if (platform === 'win32') return 'Windows';
  if (platform === 'darwin') return 'macOS';
  if (platform === 'linux') return 'Linux';
  return platform;
}

// Iniciar el descubrimiento UDP
function start(appPort) {
  currentAppPort = appPort;
  const localIp = getLocalIP();

  socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });

  socket.on('error', (err) => {
    console.error('[Discovery] Error en el socket UDP:', err.message);
  });

  socket.on('message', (msg, rinfo) => {
    try {
      const data = JSON.parse(msg.toString());
      
      // Validar protocolo
      if (data.protocol !== PROTOCOL_ID) return;

      // Ignorar beacons propios
      if (data.ip === localIp && data.port === currentAppPort) return;

      const peerKey = `${data.ip}:${data.port}`;
      peers[peerKey] = {
        hostname: data.hostname,
        ip: data.ip,
        port: data.port,
        os: data.os,
        lastSeen: Date.now()
      };

    } catch (e) {
      // Ignorar mensajes mal formateados
    }
  });

  socket.bind(DISCOVERY_PORT, () => {
    socket.setBroadcast(true);
    console.log(`[Discovery] Escuchando beacons UDP en puerto ${DISCOVERY_PORT}`);

    // Comenzar a enviar beacons
    beaconTimer = setInterval(sendBeacon, BEACON_INTERVAL);
  });

  // Limpiar peers inactivos periódicamente
  cleanupTimer = setInterval(cleanupPeers, PEER_TIMEOUT);
}

// Enviar beacon a la red
function sendBeacon() {
  if (!socket) return;

  const localIp = getLocalIP();
  const payload = JSON.stringify({
    protocol: PROTOCOL_ID,
    hostname: os.hostname(),
    ip: localIp,
    port: currentAppPort,
    os: getOSName(),
    version: '1.0.0'
  });

  const message = Buffer.from(payload);

  socket.send(message, 0, message.length, DISCOVERY_PORT, '255.255.255.255', (err) => {
    if (err) {
      // Errores comunes de red local (ej: interfaz desconectada) se ignoran silenciosamente
      if (err.code !== 'ENETUNREACH' && err.code !== 'EADDRNOTAVAIL') {
        console.error('[Discovery] Error enviando beacon UDP:', err.message);
      }
    }
  });
}

// Limpiar peers que no se han visto en más de 10 segundos
function cleanupPeers() {
  const now = Date.now();
  for (const key of Object.keys(peers)) {
    if (now - peers[key].lastSeen > PEER_TIMEOUT) {
      console.log(`[Discovery] Peer inactivo eliminado: ${peers[key].hostname} (${peers[key].ip})`);
      delete peers[key];
    }
  }
}

// Obtener lista de peers activos
function getPeers() {
  return Object.values(peers);
}

module.exports = {
  start,
  getPeers,
  getLocalIP
};
