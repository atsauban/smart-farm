import mqtt from "mqtt";

const mqttClient = mqtt.connect("mqtt://broker.hivemq.com");
const DEVICE_ID = "node-1";

export async function POST(req: Request) {
  const body = await req.json();
  const topic = `farm/${DEVICE_ID}/control`;
  mqttClient.publish(topic, JSON.stringify({ cmd: "setPump", pump: body.pump }));
  return Response.json({ ok: true });
}
