// simulator.js
import mqtt from 'mqtt';
import dotenv from 'dotenv';

dotenv.config();

const MQTT_URL = process.env.MQTT_URL || 'mqtt://broker.hivemq.com:1883';
const DEVICE_ID = process.env.DEVICE_ID || 'node-1';
const topic = `farm/${DEVICE_ID}/sensor`;

const client = mqtt.connect(MQTT_URL);

client.on('connect', () => {
  console.log('[SIM] connected, publishing to', topic);
  setInterval(() => {
    const payload = {
      temperature: +(25 + Math.random()*8).toFixed(1),
      humidity: +(60 + Math.random()*20).toFixed(0),
      soil_moisture: +(40 + Math.random()*30).toFixed(0),
      light: Math.floor(200 + Math.random()*600),
      relay_status: Math.random() > 0.7, // acak ON 30%
      mode: Math.random() > 0.5 ? 'auto' : 'manual',
      ts: Date.now()
    };
    client.publish(topic, JSON.stringify(payload));
    console.log('[SIM→MQTT] sent', payload);
  }, 3000);
});