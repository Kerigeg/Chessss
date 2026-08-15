import Fastify from "fastify";
import { Server } from "socket.io";
import type { JoinRoomRequest, MoveRequest, ServerError } from "@chessss/shared";
import { RoomError, RoomService } from "./room-service.js";

const app = Fastify({ logger: true });
const io = new Server(app.server, { cors: { origin: true } });
const rooms = new RoomService();

app.get("/health", async () => ({ status: "ok" }));

function errorResponse(error: unknown): ServerError {
  return { message: error instanceof RoomError ? error.message : "Unexpected server error." };
}

io.on("connection", (socket) => {
  socket.on("room:create", (respond: (response: unknown) => void) => {
    try {
      const response = rooms.createRoom(socket.id);
      socket.join(response.room.id);
      respond(response);
      io.to(response.room.id).emit("room:state", response.room);
    } catch (error) {
      respond({ error: errorResponse(error) });
    }
  });

  socket.on("room:join", (request: JoinRoomRequest, respond: (response: unknown) => void) => {
    try {
      const response = rooms.joinRoom(request, socket.id);
      socket.join(response.room.id);
      respond(response);
      io.to(response.room.id).emit("room:state", response.room);
    } catch (error) {
      respond({ error: errorResponse(error) });
    }
  });

  socket.on("game:move", (request: MoveRequest, respond: (response: unknown) => void) => {
    try {
      const room = rooms.move(request, socket.id);
      respond({ room });
      io.to(room.id).emit("room:state", room);
    } catch (error) {
      respond({ error: errorResponse(error) });
    }
  });

  socket.on("disconnect", () => {
    for (const room of rooms.disconnect(socket.id)) io.to(room.id).emit("room:state", room);
  });
});

const port = Number(process.env.PORT ?? 3001);
await app.listen({ port, host: "0.0.0.0" });
