// web/lib/socket.ts
import { io } from "socket.io-client";

export const socket = io(
  process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:3001",
  { transports: ["websocket"] }
);
