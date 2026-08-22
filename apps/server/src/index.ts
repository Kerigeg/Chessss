import Fastify from "fastify";
import { setTimeout as delay } from "node:timers/promises";
import { Server } from "socket.io";
import type { AnalyzeGameRequest, AuthResponse, CredentialsRequest, CreateComputerRoomRequest, GameAnalysis, JoinRoomRequest, LeaveRoomRequest, MoveRequest, RestartGameRequest, RestoreSessionRequest, ServerError } from "@chessss/shared";
import { AuthError, AuthService } from "./auth-service.js";
import { GameAnalyzer } from "./game-analyzer.js";
import { RoomError, RoomService } from "./room-service.js";

const app = Fastify({ logger: true });
const io = new Server(app.server, { cors: { origin: true } });
const rooms = new RoomService((room) => io.to(room.id).emit("room:state", room));
const auth = new AuthService();
const analyzer = new GameAnalyzer();
const COMPUTER_MOVE_DELAY_MS = 2_000;

app.get("/health", async () => ({ status: "ok" }));

function errorResponse(error: unknown): ServerError {
  return { message: error instanceof RoomError || error instanceof AuthError ? error.message : "Unexpected server error." };
}

function requireAuthenticated(socket: { data: { sessionToken?: string } }) {
  if (!socket.data.sessionToken) throw new AuthError("Please sign in before starting or joining a game.");
}

function playComputerTurn(roomId: string) {
  void delay(COMPUTER_MOVE_DELAY_MS)
    .then(() => rooms.takeComputerTurn(roomId))
    .then((room) => { if (room) io.to(room.id).emit("room:state", room); })
    .catch((error) => app.log.error(error, "Computer move failed"));
}

io.on("connection", (socket) => {
  socket.on("auth:signup", (request: CredentialsRequest, respond: (response: AuthResponse | { error: ServerError }) => void) => {
    try {
      const response = auth.signUp(request);
      socket.data.sessionToken = response.sessionToken;
      respond(response);
    } catch (error) {
      respond({ error: errorResponse(error) });
    }
  });

  socket.on("auth:signin", (request: CredentialsRequest, respond: (response: AuthResponse | { error: ServerError }) => void) => {
    try {
      const response = auth.signIn(request);
      socket.data.sessionToken = response.sessionToken;
      respond(response);
    } catch (error) {
      respond({ error: errorResponse(error) });
    }
  });

  socket.on("auth:restore", (request: RestoreSessionRequest, respond: (response: AuthResponse | { error: ServerError }) => void) => {
    try {
      const response = auth.restore(request.sessionToken);
      socket.data.sessionToken = response.sessionToken;
      respond(response);
    } catch (error) {
      respond({ error: errorResponse(error) });
    }
  });

  socket.on("auth:signout", (request: RestoreSessionRequest, respond: () => void) => {
    auth.signOut(request.sessionToken);
    delete socket.data.sessionToken;
    respond();
  });

  socket.on("room:create", (respond: (response: unknown) => void) => {
    try {
      requireAuthenticated(socket);
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
      requireAuthenticated(socket);
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
      requireAuthenticated(socket);
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
      requireAuthenticated(socket);
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
      requireAuthenticated(socket);
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
      requireAuthenticated(socket);
      const room = rooms.restart(request, socket.id);
      respond({ room });
      io.to(room.id).emit("room:state", room);
    } catch (error) {
      respond({ error: errorResponse(error) });
    }
  });

  socket.on("game:analyze", async (request: AnalyzeGameRequest, respond: (response: GameAnalysis | { error: ServerError }) => void) => {
    try {
      requireAuthenticated(socket);
      const game = rooms.analysisGame(request, socket.id);
      respond(await analyzer.analyze(game));
    } catch (error) {
      app.log.error(error, "Game analysis failed");
      respond({ error: errorResponse(error) });
    }
  });

  socket.on("disconnect", () => {
    for (const room of rooms.disconnect(socket.id)) io.to(room.id).emit("room:state", room);
  });
});

const port = Number(process.env.PORT ?? 3001);
await app.listen({ port, host: "0.0.0.0" });
