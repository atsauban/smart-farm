// server.js
import express from 'express';
import { createServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import mqtt from 'mqtt';
import cors from 'cors';
import dotenv from 'dotenv';

dotenv.config();

const PORT = process.env.PORT || 3001;
const MQTT_URL = process.env.MQTT_URL || 'mqtt://broker.hivemq.com:1883';
const TOPIC_SENSOR = process.env.TOPIC_SENSOR || 'farm/+/sensor';
const TOPIC_CONTROL_PREFIX = process.env.TOPIC_CONTROL_PREFIX || 'farm';

// State terakhir per deviceId
const state = new Map(); // key: deviceId, value: payload terakhir

// Express + HTTP + Socket.IO
const app = express();
app.use(cors());
app.use(express.json());
const httpServer = createServer(app);
const io = new SocketIOServer(httpServer, { cors: { origin: '*' } });

// MQTT client
const mqttClient = mqtt.connect(MQTT_URL, {
  username: process.env.MQTT_USERNAME || undefined,
  password: process.env.MQTT_PASSWORD || undefined,
});

mqttClient.on('connect', () => {
  console.log('[MQTT] connected:', MQTT_URL);
  mqttClient.subscribe(TOPIC_SENSOR, (err) => {
    if (err) console.error('[MQTT] subscribe error:', err);
    else console.log('[MQTT] subscribed to', TOPIC_SENSOR);
  });
});

mqttClient.on('message', (topic, message) => {
  // Contoh topic: farm/node-1/sensor
  try {
    const parts = topic.split('/');
    const deviceId = parts[1] || 'unknown';
    const payload = JSON.parse(message.toString());
    // simpan timestamp server juga
    const enriched = { ...payload, deviceId, serverTs: Date.now() };
    state.set(deviceId, enriched);
    // broadcast ke semua dashboard
    io.emit('sensor:data', enriched);
    console.log('[MQTT→WS] sensor', deviceId, enriched);
  } catch (e) {
    console.error('Invalid message on', topic, e.message);
  }
});

io.on('connection', (socket) => {
  console.log('[WS] dashboard connected');
  // kirim snapshot awal
  const snapshot = Array.from(state.values());
  socket.emit('sensor:snapshot', snapshot);

  // terima perintah control dari dashboard
  socket.on('control:send', (msg) => {
    // msg contoh: { deviceId: 'node-1', cmd: 'setPump', pump: true }
    const { deviceId, ...rest } = msg || {};
    if (!deviceId) return;
    const controlTopic = `${TOPIC_CONTROL_PREFIX}/${deviceId}/control`;
    mqttClient.publish(controlTopic, JSON.stringify(rest), { qos: 0 });
    console.log('[WS→MQTT] control', controlTopic, rest);
  });
});

// REST bantu: ambil state terakhir
app.get('/api/last', (_req, res) => {
  res.json({ devices: Array.from(state.values()) });
});

// REST bantu: publish kontrol pakai HTTP (untuk tes cepat via curl/Postman)
app.post('/api/control', (req, res) => {
  const { deviceId, ...rest } = req.body || {};
  if (!deviceId) return res.status(400).json({ error: 'deviceId required' });
  const controlTopic = `${TOPIC_CONTROL_PREFIX}/${deviceId}/control`;
  mqttClient.publish(controlTopic, JSON.stringify(rest), { qos: 0 });
  res.json({ ok: true, topic: controlTopic, payload: rest });
});

// Halaman debug minimal (lihat data real-time tanpa frontend Next.js dulu)
app.get('/debug', (_req, res) => {
  res.setHeader('Content-Type', 'text/html');
  res.end(`<!doctype html>
<html>
<head><meta charset="utf-8"/><title>Debug Live</title></head>
<body>
  <h1>Smart Farm — Live Debug</h1>
  <pre id="log"></pre>
  <script src="https://cdn.socket.io/4.7.5/socket.io.min.js"></script>
  <script>
    const log = document.getElementById('log');
    const socket = io('/');
    const println = (o) => log.textContent = (new Date().toLocaleTimeString()+" "+o+"\n"+log.textContent);

    socket.on('connect', () => println('[WS] connected'));
    socket.on('sensor:snapshot', (arr) => println('[snapshot] '+JSON.stringify(arr, null, 2)));
    socket.on('sensor:data', (data) => println('[data] '+JSON.stringify(data)));
  </script>
</body>
</html>`);
});

httpServer.listen(PORT, () => console.log(`[HTTP] listening on http://localhost:${PORT}`));