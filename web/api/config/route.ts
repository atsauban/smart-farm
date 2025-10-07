import mqtt from "mqtt";

const mqttClient = mqtt.connect("mqtt://broker.hivemq.com");
const DEVICE_ID = "node-1";

export async function POST(req: Request) {
  const body = await req.json();
  const { mode, thresholds } = body;
  const topic = `farm/${DEVICE_ID}/control`;

  mqttClient.publish(
    topic,
    JSON.stringify({
      cmd: "setThresholds",
      ...thresholds,
    })
  );

  if (mode) {
    mqttClient.publish(topic, JSON.stringify({ cmd: "setMode", mode }));
  }

  return Response.json({ ok: true });
}
