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
const DEVICE_TIMEOUT_MS = Number(process.env.DEVICE_TIMEOUT_MS || 15000);

// State terakhir per deviceId
const state = new Map(); // key: deviceId, value: payload terakhir
const rulesState = new Map(); // key: deviceId, value: { rules, savedAt }
const deviceTimers = new Map(); // key: deviceId, value: timeout handle

// Express + HTTP + Socket.IO
const app = express();
app.use(cors());
app.use(express.json());
const httpServer = createServer(app);
const io = new SocketIOServer(httpServer, { cors: { origin: '*' } });

const markOffline = (deviceId) => {
  const existing = state.get(deviceId);
  const wasOnline = existing?.online;
  if (wasOnline === false) return;
  const serverTs = Date.now();
  const offlinePayload = { ...(existing ?? { deviceId }), deviceId, online: false, serverTs };
  state.set(deviceId, offlinePayload);
  io.emit('device:status', { deviceId, online: false, serverTs });
  deviceTimers.delete(deviceId);
};

const scheduleOffline = (deviceId) => {
  if (deviceTimers.has(deviceId)) {
    clearTimeout(deviceTimers.get(deviceId));
  }
  const timer = setTimeout(() => markOffline(deviceId), DEVICE_TIMEOUT_MS);
  deviceTimers.set(deviceId, timer);
};

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
    const serverTs = Date.now();
    const enriched = { ...payload, deviceId, serverTs, online: true };
    state.set(deviceId, enriched);
    // broadcast ke semua dashboard
    io.emit('sensor:data', enriched);
    io.emit('device:status', { deviceId, online: true, serverTs });
    scheduleOffline(deviceId);
    console.log('[MQTT->WS] sensor', deviceId, enriched);
  } catch (e) {
    console.error('Invalid message on', topic, e.message);
  }
});

io.on('connection', (socket) => {
  console.log('[WS] dashboard connected');
  // kirim snapshot awal
  const snapshot = Array.from(state.values());
  socket.emit('sensor:snapshot', snapshot);

  if (rulesState.size) {
    socket.emit(
      'rules:snapshot',
      Array.from(rulesState.entries()).map(([deviceId, info]) => ({
        deviceId,
        ...info,
      })),
    );
  }

  // terima perintah control dari dashboard
  socket.on('control:send', (msg, reply) => {
    const { deviceId, ...rest } = msg || {};
    if (!deviceId) {
      if (typeof reply === 'function') reply({ ok: false, error: 'deviceId required' });
      return;
    }
    const controlTopic = `${TOPIC_CONTROL_PREFIX}/${deviceId}/control`;
    mqttClient.publish(controlTopic, JSON.stringify(rest), { qos: 0 }, (err) => {
      if (err) {
        console.error('[WS->MQTT] control error', controlTopic, err);
        if (typeof reply === 'function') reply({ ok: false, error: err.message });
        return;
      }
      console.log('[WS->MQTT] control', controlTopic, rest);
      if (typeof reply === 'function') reply({ ok: true, topic: controlTopic, payload: rest });
    });
  });

  socket.on('rules:save', (msg, reply) => {
    const { deviceId, rules } = msg || {};
    if (!deviceId || !Array.isArray(rules)) {
      if (typeof reply === 'function') reply({ ok: false, error: 'deviceId dan rules wajib' });
      return;
    }
    const savedAt = Date.now();
    rulesState.set(deviceId, { rules, savedAt });

    const controlTopic = `${TOPIC_CONTROL_PREFIX}/${deviceId}/control`;
    const payload = { cmd: 'setRules', rules, savedAt };
    mqttClient.publish(controlTopic, JSON.stringify(payload), { qos: 0 }, (err) => {
      if (err) {
        console.error('[WS->MQTT] setRules error', controlTopic, err);
        if (typeof reply === 'function') reply({ ok: false, error: err.message });
        return;
      }
      if (typeof reply === 'function') reply({ ok: true, savedAt });
      io.emit(
        'rules:snapshot',
        Array.from(rulesState.entries()).map(([id, info]) => ({
          deviceId: id,
          ...info,
        })),
      );
    });
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
  mqttClient.publish(controlTopic, JSON.stringify(rest), { qos: 0 }, (err) => {
    if (err) {
      console.error('[HTTP->MQTT] control error', controlTopic, err);
      return res.status(502).json({ ok: false, error: err.message });
    }
    res.json({ ok: true, topic: controlTopic, payload: rest });
  });
});

// Halaman debug minimal (lihat data real-time tanpa frontend Next.js dulu)
app.get('/debug', (_req, res) => {
  res.setHeader('Content-Type', 'text/html');
  res.end(`<!doctype html>
<html>
<head><meta charset="utf-8"/><title>Debug Live</title></head>
<body>
  <h1>Smart Farm - Live Debug</h1>
  <pre id="log"></pre>
  <script src="https://cdn.socket.io/4.7.5/socket.io.min.js"></script>
  <script>
    const log = document.getElementById('log');
    const socket = io('/');
    const println = (o) => log.textContent = (new Date().toLocaleTimeString()+" "+o+"\\n"+log.textContent);

    socket.on('connect', () => println('[WS] connected'));
    socket.on('sensor:snapshot', (arr) => println('[snapshot] '+JSON.stringify(arr, null, 2)));
    socket.on('sensor:data', (data) => println('[data] '+JSON.stringify(data)));
    socket.on('device:status', (status) => println('[status] '+JSON.stringify(status)));
  </script>
</body>
</html>`);
});

httpServer.listen(PORT, () => console.log(`[HTTP] listening on http://localhost:${PORT}`));

