import { useEffect, useMemo, useState } from "react";
import { io, type Socket } from "socket.io-client";
import type { ChessColor, JoinRoomResponse, MoveRequest, RoomSnapshot, ServerError } from "@chessss/shared";

const STORAGE_KEY = "chessss-player-session";
const glyphs: Record<string, string> = {
  wp: "♙", wn: "♘", wb: "♗", wr: "♖", wq: "♕", wk: "♔",
  bp: "♟", bn: "♞", bb: "♝", br: "♜", bq: "♛", bk: "♚",
};

interface SavedSession { roomId: string; playerToken: string; }
type Ack<T extends object> = T | { error: ServerError };

function hasError<T extends object>(value: Ack<T>): value is { error: ServerError } {
  return "error" in value;
}

function loadSession(): SavedSession | null {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null") as SavedSession | null; } catch { return null; }
}

function saveSession(roomId: string, playerToken: string) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ roomId, playerToken }));
}

function boardFromFen(fen: string): Map<string, string> {
  const board = new Map<string, string>();
  const rows = fen.split(" ")[0].split("/");
  rows.forEach((row, index) => {
    let file = 0;
    for (const symbol of row) {
      if (/\d/.test(symbol)) file += Number(symbol);
      else {
        board.set(`${"abcdefgh"[file]}${8 - index}`, symbol);
        file += 1;
      }
    }
  });
  return board;
}

function colorName(color: ChessColor) { return color === "white" ? "White" : "Black"; }

function resultText(room: RoomSnapshot): string | null {
  const result = room.game.result;
  if (!result) return null;
  if (result.kind === "checkmate") return `${colorName(result.winner!)} wins by checkmate.`;
  return `Draw — ${result.kind.replaceAll("-", " ")}.`;
}

export function App() {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [connected, setConnected] = useState(false);
  const [room, setRoom] = useState<RoomSnapshot | null>(null);
  const [playerToken, setPlayerToken] = useState<string | null>(null);
  const [playerColor, setPlayerColor] = useState<ChessColor | null>(null);
  const [roomInput, setRoomInput] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [pendingPromotion, setPendingPromotion] = useState<{ from: string; to: string } | null>(null);
  const [notice, setNotice] = useState("Create a room or join a friend with their room code.");

  useEffect(() => {
    const serverUrl = import.meta.env.VITE_SERVER_URL ?? `${window.location.protocol}//${window.location.hostname}:3001`;
    const client = io(serverUrl);
    client.on("connect", () => {
      setConnected(true);
      const saved = loadSession();
      if (saved) {
        client.emit("room:join", saved, (response: Ack<JoinRoomResponse>) => {
          if (hasError(response)) return;
          setRoom(response.room);
          setPlayerToken(response.playerToken);
          setPlayerColor(response.playerColor);
          setNotice(`Rejoined room ${response.room.id} as ${colorName(response.playerColor)}.`);
        });
      }
    });
    client.on("disconnect", () => setConnected(false));
    client.on("room:state", (next: RoomSnapshot) => setRoom(next));
    setSocket(client);
    return () => { client.close(); };
  }, []);

  const pieces = useMemo(() => room ? boardFromFen(room.game.fen) : new Map<string, string>(), [room]);
  const isYourTurn = Boolean(room && playerColor && room.status === "active" && room.game.turn === playerColor);

  function acceptJoin(response: JoinRoomResponse) {
    saveSession(response.room.id, response.playerToken);
    setRoom(response.room);
    setPlayerToken(response.playerToken);
    setPlayerColor(response.playerColor);
    setSelected(null);
    setPendingPromotion(null);
    setNotice(`You are ${colorName(response.playerColor)}. Share the code with your opponent.`);
  }

  function createRoom() {
    if (!socket || !connected) return setNotice("Connecting to the game server…");
    socket.emit("room:create", (response: Ack<JoinRoomResponse>) => {
      if (hasError(response)) return setNotice(response.error.message);
      acceptJoin(response);
    });
  }

  function joinRoom() {
    if (!socket || !connected) return setNotice("Connecting to the game server…");
    const roomId = roomInput.trim().toUpperCase();
    if (!roomId) return setNotice("Enter a room code first.");
    socket.emit("room:join", { roomId }, (response: Ack<JoinRoomResponse>) => {
      if (hasError(response)) return setNotice(response.error.message);
      acceptJoin(response);
    });
  }

  function submitMove(from: string, to: string, promotion?: "q" | "r" | "b" | "n") {
    if (!room || !playerToken || !socket) return;
    const request: MoveRequest = { roomId: room.id, playerToken, from, to, promotion };
    socket.emit("game:move", request, (response: Ack<{ room: RoomSnapshot }>) => {
      if (hasError(response)) return setNotice(response.error.message);
      setRoom(response.room);
      setSelected(null);
      setPendingPromotion(null);
    });
  }

  function selectSquare(square: string) {
    if (!room || !playerColor || !playerToken || !socket) return;
    const piece = pieces.get(square);
    const isOwnPiece = piece && (piece === piece.toUpperCase() ? playerColor === "white" : playerColor === "black");
    if (!selected) {
      if (isYourTurn && isOwnPiece) setSelected(square);
      return;
    }
    if (square === selected) return setSelected(null);
    if (isYourTurn) {
      const movingPiece = pieces.get(selected);
      if (movingPiece?.toLowerCase() === "p" && (square.endsWith("1") || square.endsWith("8"))) {
        setPendingPromotion({ from: selected, to: square });
        setSelected(null);
      } else submitMove(selected, square);
    }
  }

  const ranks = playerColor === "black" ? [1, 2, 3, 4, 5, 6, 7, 8] : [8, 7, 6, 5, 4, 3, 2, 1];
  const files = playerColor === "black" ? ["h", "g", "f", "e", "d", "c", "b", "a"] : ["a", "b", "c", "d", "e", "f", "g", "h"];

  return (
    <main>
      <header>
        <p className="eyebrow">LAN MULTIPLAYER</p>
        <h1>Chessss</h1>
        <span className={`connection ${connected ? "online" : ""}`}>{connected ? "Server connected" : "Connecting…"}</span>
      </header>

      {!room ? (
        <section className="lobby card">
          <h2>Play a local game</h2>
          <p>Start a room, then send its six-character code to the other player on your network.</p>
          <button className="primary" onClick={createRoom}>Create room</button>
          <div className="divider"><span>or</span></div>
          <label htmlFor="room-code">Room code</label>
          <div className="join-row">
            <input id="room-code" value={roomInput} onChange={(event) => setRoomInput(event.target.value)} onKeyDown={(event) => event.key === "Enter" && joinRoom()} placeholder="ABC123" maxLength={6} autoCapitalize="characters" />
            <button onClick={joinRoom}>Join room</button>
          </div>
          <p className="notice">{notice}</p>
        </section>
      ) : (
        <section className="game-layout">
          <div className="board-card">
            <div className="board" aria-label="Chess board">
              {ranks.flatMap((rank, row) => files.map((file, column) => {
                const square = `${file}${rank}`;
                const piece = pieces.get(square);
                const key = piece ? `${piece === piece.toUpperCase() ? "w" : "b"}${piece.toLowerCase()}` : "";
                return <button key={square} className={`square ${(row + column) % 2 ? "dark" : "light"} ${selected === square ? "selected" : ""}`} onClick={() => selectSquare(square)} aria-label={square}>
                  {column === 0 && <small className="rank">{rank}</small>}
                  {piece && <span className="piece">{glyphs[key]}</span>}
                  {row === 7 && <small className="file">{file}</small>}
                </button>;
              }))}
            </div>
            <p className="board-help">Select one of your pieces, then select its destination. Choose a piece when a pawn reaches the last rank.</p>
          </div>
          <aside className="game-panel card">
            <p className="eyebrow">ROOM</p>
            <div className="room-code">{room.id}</div>
            <p className="share">Share this code with your opponent.</p>
            <div className="players">
              {(["white", "black"] as ChessColor[]).map((color) => {
                const player = room.players.find((entry) => entry.color === color);
                return <div className="player" key={color}><span>{colorName(color)} {playerColor === color ? "(you)" : ""}</span><em className={player?.connected ? "present" : ""}>{player?.connected ? "connected" : "waiting"}</em></div>;
              })}
            </div>
            <div className="turn-status">
              {resultText(room) ?? (room.status === "waiting" ? "Waiting for Black to join." : `${colorName(room.game.turn)} to move${room.game.isCheck ? " — check" : ""}.`)}
            </div>
            <p className="notice">{notice}</p>
            <h3>Moves</h3>
            <ol className="moves">
              {room.game.moves.length === 0 ? <li>No moves yet.</li> : room.game.moves.map((move, index) => <li key={`${move.san}-${index}`}><span>{Math.floor(index / 2) + 1}{index % 2 === 0 ? "." : "…"}</span>{move.san}</li>)}
            </ol>
          </aside>
        </section>
      )}
      {pendingPromotion && <div className="promotion-backdrop" role="dialog" aria-modal="true" aria-label="Choose promotion piece">
        <div className="promotion card">
          <h2>Promote pawn</h2>
          <p>Choose the new piece.</p>
          <div className="promotion-options">
            {(["q", "r", "b", "n"] as const).map((piece) => <button key={piece} onClick={() => submitMove(pendingPromotion.from, pendingPromotion.to, piece)}>{glyphs[`${playerColor === "white" ? "w" : "b"}${piece}`]}</button>)}
          </div>
          <button className="cancel" onClick={() => setPendingPromotion(null)}>Cancel</button>
        </div>
      </div>}
    </main>
  );
}
