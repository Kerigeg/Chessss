import Fastify from "fastify";
import { setTimeout as delay } from "node:timers/promises";
import { Server } from "socket.io";
import type { CreateComputerRoomRequest, JoinRoomRequest, LeaveRoomRequest, MoveRequest, RestartGameRequest, ServerError } from "@chessss/shared";
import { RoomError, RoomService } from "./room-service.js";

const app = Fastify({ logger: true });
const io = new Server(app.server, { cors: { origin: true } });
const rooms = new RoomService((room) => io.to(room.id).emit("room:state", room));
const COMPUTER_MOVE_DELAY_MS = 2_000;

app.get("/health", async () => ({ status: "ok" }));

function errorResponse(error: unknown): ServerError {
  return { message: error instanceof RoomError ? error.message : "Unexpected server error." };
}

function playComputerTurn(roomId: string) {
  void delay(COMPUTER_MOVE_DELAY_MS)
    .then(() => rooms.takeComputerTurn(roomId))
    .then((room) => { if (room) io.to(room.id).emit("room:state", room); })
    .catch((error) => app.log.error(error, "Computer move failed"));
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

  socket.on("computer:create", (request: CreateComputerRoomRequest, respond: (response: unknown) => void) => {
    try {
      const response = rooms.createComputerRoom(request, socket.id);
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

  socket.on("room:leave", (request: LeaveRoomRequest, respond: (response: unknown) => void) => {
    try {
      const room = rooms.leave(request, socket.id);
      socket.leave(room.id);
      respond({ room });
      io.to(room.id).emit("room:state", room);
    } catch (error) {
      respond({ error: errorResponse(error) });
    }
  });

  socket.on("game:move", (request: MoveRequest, respond: (response: unknown) => void) => {
    try {
      const room = rooms.move(request, socket.id);
      respond({ room });
      io.to(room.id).emit("room:state", room);
      playComputerTurn(room.id);
    } catch (error) {
      respond({ error: errorResponse(error) });
    }
  });

  socket.on("game:restart", (request: RestartGameRequest, respond: (response: unknown) => void) => {
    try {
      const room = rooms.restart(request, socket.id);
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
