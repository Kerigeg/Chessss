import { useEffect, useMemo, useState, type FormEvent } from "react";
import { io, type Socket } from "socket.io-client";
import type { AuthResponse, AuthUser, ChessColor, ComputerLevel, CreateComputerRoomRequest, CredentialsRequest, GameAnalysis, JoinRoomResponse, MoveAnalysis, MoveRequest, RestartGameRequest, RoomSnapshot, ServerError } from "@chessss/shared";

const STORAGE_KEY = "chessss-player-session";
const AUTH_STORAGE_KEY = "chessss-auth-session";
const glyphs: Record<string, string> = {
  wp: "♙", wn: "♘", wb: "♗", wr: "♖", wq: "♕", wk: "♔",
  bp: "♟", bn: "♞", bb: "♝", br: "♜", bq: "♛", bk: "♚",
};
const computerLevels: Array<{ id: ComputerLevel; title: string; detail: string }> = [
  { id: "beginner", title: "Beginner", detail: "Approx. Elo 250" },
  { id: "medium", title: "Medium", detail: "Approx. Elo 700" },
  { id: "high", title: "High", detail: "Approx. Elo 1400" },
  { id: "hell", title: "Hell", detail: "Approx. Elo 2100" },
  { id: "stockfish", title: "Stockfish", detail: "Full engine strength" },
];
const computerTimeControls = [
  { milliseconds: 60_000, label: "1 minute" },
  { milliseconds: 180_000, label: "3 minutes" },
  { milliseconds: 300_000, label: "5 minutes" },
  { milliseconds: 600_000, label: "10 minutes" },
  { milliseconds: 1_800_000, label: "30 minutes" },
  { milliseconds: 2_700_000, label: "45 minutes" },
];

interface SavedSession { roomId: string; playerToken: string; }
interface SavedAuthSession { sessionToken: string; }
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

function clearSession() {
  localStorage.removeItem(STORAGE_KEY);
}

function loadAuthSession(): SavedAuthSession | null {
  try { return JSON.parse(localStorage.getItem(AUTH_STORAGE_KEY) ?? "null") as SavedAuthSession | null; } catch { return null; }
}

function saveAuthSession(sessionToken: string) {
  localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify({ sessionToken }));
}

function clearAuthSession() {
  localStorage.removeItem(AUTH_STORAGE_KEY);
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
function computerLabel(level: ComputerLevel | null) { return computerLevels.find((option) => option.id === level)?.title ?? "Computer"; }
function timeControlLabel(milliseconds: number) { return computerTimeControls.find((option) => option.milliseconds === milliseconds)?.label ?? `${Math.round(milliseconds / 60_000)} minutes`; }

function resultText(room: RoomSnapshot): string | null {
  const result = room.game.result;
  if (!result) return null;
  if (result.kind === "checkmate") return `${colorName(result.winner!)} wins by checkmate.`;
  if (result.kind === "timeout") return `${colorName(result.winner!)} wins on time.`;
  return `Draw — ${result.kind.replaceAll("-", " ")}.`;
}

function remainingMilliseconds(room: RoomSnapshot, color: ChessColor, now: number): number {
  const stored = color === "white" ? room.clock.whiteMs : room.clock.blackMs;
  if (room.clock.activeColor !== color || room.clock.turnStartedAt === null) return stored;
  return Math.max(0, stored - (now - room.clock.turnStartedAt));
}

function formatClock(milliseconds: number): string {
  const seconds = Math.ceil(milliseconds / 1_000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function pgnResult(room: RoomSnapshot): string {
  if (!room.game.result) return "*";
  if (!room.game.result.winner) return "1/2-1/2";
  return room.game.result.winner === "white" ? "1-0" : "0-1";
}

function pgnFor(room: RoomSnapshot): string {
  const movetext = room.game.moves.map((move, index) => `${index % 2 === 0 ? `${Math.floor(index / 2) + 1}. ` : ""}${move.san}`).join(" ");
  const result = pgnResult(room);
  return `[Event "Chessss game"]\n[Site "LAN"]\n[Result "${result}"]\n\n${movetext}${movetext ? " " : ""}${result}\n`;
}

function evaluationText(scoreCp: number): string {
  const score = (scoreCp / 100).toFixed(1);
  return `${scoreCp > 0 ? "+" : ""}${score}`;
}

function labelText(label: MoveAnalysis["label"]): string {
  return label[0].toUpperCase() + label.slice(1);
}

export function App() {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [connected, setConnected] = useState(false);
  const [authChecked, setAuthChecked] = useState(false);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [authMode, setAuthMode] = useState<"signin" | "signup">("signin");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [room, setRoom] = useState<RoomSnapshot | null>(null);
  const [playerToken, setPlayerToken] = useState<string | null>(null);
  const [playerColor, setPlayerColor] = useState<ChessColor | null>(null);
  const [roomInput, setRoomInput] = useState("");
  const [lobbyMode, setLobbyMode] = useState<"choose" | "human" | "computer" | "computer-time">("choose");
  const [selectedComputerLevel, setSelectedComputerLevel] = useState<ComputerLevel | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [pendingPromotion, setPendingPromotion] = useState<{ from: string; to: string } | null>(null);
  const [notice, setNotice] = useState("Create a room or join a friend with their room code.");
  const [clockNow, setClockNow] = useState(() => Date.now());
  const [replayIndex, setReplayIndex] = useState<number | null>(null);
  const [analysis, setAnalysis] = useState<GameAnalysis | null>(null);
  const [analyzing, setAnalyzing] = useState(false);

  useEffect(() => {
    const serverUrl = import.meta.env.VITE_SERVER_URL ?? `${window.location.protocol}//${window.location.hostname}:3001`;
    const client = io(serverUrl);
    client.on("connect", () => {
      setConnected(true);
      const rejoinRoom = () => {
        const saved = loadSession();
        if (!saved) return;
        client.emit("room:join", saved, (response: Ack<JoinRoomResponse>) => {
          if (hasError(response)) return;
          setRoom(response.room);
          setPlayerToken(response.playerToken);
          setPlayerColor(response.playerColor);
          setNotice(`Rejoined room ${response.room.id} as ${colorName(response.playerColor)}.`);
        });
      };
      const savedAuth = loadAuthSession();
      if (!savedAuth) {
        setAuthChecked(true);
        return;
      }
      client.emit("auth:restore", savedAuth, (response: Ack<AuthResponse>) => {
        if (!hasError(response)) {
          setUser(response.user);
          rejoinRoom();
        } else {
          clearAuthSession();
          clearSession();
          setUser(null);
          setRoom(null);
          setPlayerToken(null);
          setPlayerColor(null);
        }
        setAuthChecked(true);
      });
    });
    client.on("disconnect", () => setConnected(false));
    client.on("room:state", (next: RoomSnapshot) => setRoom(next));
    setSocket(client);
    return () => { client.close(); };
  }, []);

  useEffect(() => {
    const interval = window.setInterval(() => setClockNow(Date.now()), 100);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    setReplayIndex(null);
    setAnalysis(null);
  }, [room?.id, room?.game.moves.length]);

  const replayPosition = room && replayIndex !== null ? room.game.positionHistory[replayIndex] : undefined;
  const pieces = useMemo(() => room ? boardFromFen(replayPosition ?? room.game.fen) : new Map<string, string>(), [room, replayPosition]);
  const isYourTurn = Boolean(room && replayIndex === null && playerColor && room.status === "active" && room.game.turn === playerColor);

  function acceptJoin(response: JoinRoomResponse) {
    saveSession(response.room.id, response.playerToken);
    setRoom(response.room);
    setPlayerToken(response.playerToken);
    setPlayerColor(response.playerColor);
    setSelected(null);
    setPendingPromotion(null);
    setNotice(response.room.mode === "computer"
      ? `You are White. ${computerLabel(response.room.computerLevel)} plays Black.`
      : `You are ${colorName(response.playerColor)}. Share the code with your opponent.`);
  }

  function createRoom() {
    if (!socket || !connected) return setNotice("Connecting to the game server…");
    socket.emit("room:create", (response: Ack<JoinRoomResponse>) => {
      if (hasError(response)) return setNotice(response.error.message);
      acceptJoin(response);
    });
  }

  function submitAuth(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!socket || !connected) return setNotice("Connecting to the game server…");
    const request: CredentialsRequest = { username, password };
    socket.emit(`auth:${authMode}`, request, (response: Ack<AuthResponse>) => {
      if (hasError(response)) return setNotice(response.error.message);
      saveAuthSession(response.sessionToken);
      setUser(response.user);
      setPassword("");
      setNotice(`Signed in as ${response.user.username}. Choose how you want to play.`);
    });
  }

  function signOut() {
    const saved = loadAuthSession();
    if (room && playerToken && socket) socket.emit("room:leave", { roomId: room.id, playerToken }, () => undefined);
    if (saved && socket) socket.emit("auth:signout", saved, () => undefined);
    clearAuthSession();
    clearSession();
    setUser(null);
    setRoom(null);
    setPlayerToken(null);
    setPlayerColor(null);
    setLobbyMode("choose");
    setNotice("Sign in to start a game.");
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

  function createComputerRoom(level: ComputerLevel, initialTimeMs: number) {
    if (!socket || !connected) return setNotice("Connecting to the game server…");
    const request: CreateComputerRoomRequest = { level, initialTimeMs };
    socket.emit("computer:create", request, (response: Ack<JoinRoomResponse>) => {
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

  function restartGame() {
    if (!room || !playerToken || !socket) return;
    const request: RestartGameRequest = { roomId: room.id, playerToken };
    socket.emit("game:restart", request, (response: Ack<{ room: RoomSnapshot }>) => {
      if (hasError(response)) return setNotice(response.error.message);
      setRoom(response.room);
      setSelected(null);
      setNotice("A new game has started. White to move.");
    });
  }

  function returnToHome() {
    const reset = () => {
      clearSession();
      setRoom(null);
      setPlayerToken(null);
      setPlayerColor(null);
      setSelected(null);
      setPendingPromotion(null);
      setLobbyMode("choose");
      setNotice("Choose how you want to play your next game.");
    };
    if (!room || !playerToken || !socket) return reset();
    socket.emit("room:leave", { roomId: room.id, playerToken }, () => undefined);
    reset();
  }

  function downloadPgn() {
    if (!room) return;
    const url = URL.createObjectURL(new Blob([pgnFor(room)], { type: "application/x-chess-pgn;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `chessss-${room.id}.pgn`;
    link.click();
    URL.revokeObjectURL(url);
  }

  function analyzeGame() {
    if (!room || !playerToken || !socket || room.status !== "finished") return;
    setAnalyzing(true);
    setNotice("Analyzing every move with Stockfish…");
    socket.emit("game:analyze", { roomId: room.id, playerToken }, (response: Ack<GameAnalysis>) => {
      setAnalyzing(false);
      if (hasError(response)) return setNotice(response.error.message);
      setAnalysis(response);
      setNotice("Analysis complete. Labels and evaluations are shown beside each move.");
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
    if (isYourTurn && isOwnPiece) return setSelected(square);
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
        {user && <span className="account">{user.username} <button onClick={signOut}>Sign out</button></span>}
        <span className={`connection ${connected ? "online" : ""}`}>{connected ? "Server connected" : "Connecting…"}</span>
      </header>

      {!authChecked ? <section className="lobby card"><p>Restoring your session…</p></section> : !user ? (
        <section className="lobby card auth-card">
          <p className="eyebrow">ACCOUNT</p>
          <h2>{authMode === "signin" ? "Welcome back" : "Create your account"}</h2>
          <p>{authMode === "signin" ? "Sign in to create or join a chess game." : "Register with a username and password to start playing."}</p>
          <form onSubmit={submitAuth}>
            <label htmlFor="username">Username</label>
            <input id="username" value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username" minLength={3} maxLength={24} pattern="[A-Za-z0-9_]+" required />
            <label htmlFor="password">Password</label>
            <input id="password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete={authMode === "signin" ? "current-password" : "new-password"} minLength={8} maxLength={128} required />
            <button className="primary" type="submit">{authMode === "signin" ? "Sign in" : "Sign up"}</button>
          </form>
          <button className="auth-switch" onClick={() => setAuthMode((mode) => mode === "signin" ? "signup" : "signin")}>{authMode === "signin" ? "Need an account? Sign up" : "Already have an account? Sign in"}</button>
          <p className="notice">{notice}</p>
        </section>
      ) : !room ? (
        lobbyMode === "choose" ? (
          <section className="lobby card">
            <h2>Choose how to play</h2>
            <p>Play a friend on your local network, or challenge the computer.</p>
            <div className="mode-options">
              <button className="mode-option" onClick={() => setLobbyMode("human")}><span>♚</span><strong>Play a person</strong><small>Create or join a LAN room</small></button>
              <button className="mode-option" onClick={() => setLobbyMode("computer")}><span>♞</span><strong>Play the computer</strong><small>Choose a Stockfish difficulty</small></button>
            </div>
            <p className="notice">{notice}</p>
          </section>
        ) : lobbyMode === "human" ? (
          <section className="lobby card">
            <button className="back" onClick={() => setLobbyMode("choose")}>← Back</button>
            <h2>Play a person</h2>
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
        ) : lobbyMode === "computer" ? (
          <section className="lobby card">
            <button className="back" onClick={() => setLobbyMode("choose")}>← Back</button>
            <h2>Choose computer strength</h2>
            <p>You play White. The computer plays Black.</p>
            <div className="level-options">
              {computerLevels.map((level) => <button key={level.id} className="level-option" onClick={() => { setSelectedComputerLevel(level.id); setLobbyMode("computer-time"); }}><strong>{level.title}</strong><small>{level.detail}</small></button>)}
            </div>
            <p className="notice">{notice}</p>
          </section>
        ) : (
          <section className="lobby card">
            <button className="back" onClick={() => setLobbyMode("computer")}>← Back</button>
            <h2>Choose time per player</h2>
            <p>Playing against {computerLabel(selectedComputerLevel)}. Both sides receive the selected amount of time.</p>
            <div className="level-options time-options">
              {computerTimeControls.map((control) => <button key={control.milliseconds} className="level-option" onClick={() => selectedComputerLevel && createComputerRoom(selectedComputerLevel, control.milliseconds)}><strong>{control.label}</strong><small>Per player</small></button>)}
            </div>
            <p className="notice">{notice}</p>
          </section>
        )
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
            <p className="board-help">{replayIndex !== null ? `Reviewing ${replayIndex === 0 ? "the starting position" : `move ${replayIndex}`}. Select Latest to resume the live board.` : "Select one of your pieces, then select its destination. Choose a piece when a pawn reaches the last rank."}</p>
          </div>
          <aside className="game-panel card">
            <p className="eyebrow">{room.mode === "computer" ? "COMPUTER" : "ROOM"}</p>
            <div className="room-code">{room.mode === "computer" ? computerLabel(room.computerLevel) : room.id}</div>
            <p className="share">{room.mode === "computer" ? `You are White. The computer is Black. ${timeControlLabel(room.timeControl.initialTimeMs)} each.` : "Share this code with your opponent."}</p>
            <div className="players">
              {(["white", "black"] as ChessColor[]).map((color) => {
                const player = room.players.find((entry) => entry.color === color);
                const milliseconds = remainingMilliseconds(room, color, clockNow);
                const active = room.clock.activeColor === color;
                const label = player?.kind === "computer" ? `${computerLabel(room.computerLevel)} (${colorName(color)})` : `${colorName(color)} ${playerColor === color ? "(you)" : ""}`;
                return <div className={`player ${active ? "active-clock" : ""}`} key={color}><span>{label}</span><strong className={milliseconds <= 20_000 ? "low-time" : ""}>{formatClock(milliseconds)}</strong><em className={player?.connected ? "present" : ""}>{player?.kind === "computer" ? active ? "thinking" : "ready" : player?.connected ? "connected" : "waiting"}</em></div>;
              })}
            </div>
            <div className="turn-status">
              {resultText(room) ?? (room.status === "waiting" ? "Waiting for Black to join." : `${colorName(room.game.turn)} to move${room.game.isCheck ? " — check" : ""}.`)}
            </div>
            {room.status === "finished" && <div className="finish-actions"><button className="primary restart" onClick={restartGame}>Play rematch</button><button className="home" onClick={returnToHome}>Return to home</button></div>}
            <p className="notice">{notice}</p>
            <h3>Moves</h3>
            {room.status === "finished" && <div className="review-actions">
              <button onClick={() => setReplayIndex((current) => Math.max(0, (current ?? room.game.moves.length) - 1))} disabled={replayIndex === 0}>← Previous</button>
              <button onClick={() => setReplayIndex((current) => Math.min(room.game.moves.length, (current ?? room.game.moves.length) + 1))} disabled={replayIndex === room.game.moves.length}>Next →</button>
              <button onClick={() => setReplayIndex(null)} disabled={replayIndex === null}>Latest</button>
              <button onClick={downloadPgn}>Download PGN</button>
              <button className="analyze" onClick={analyzeGame} disabled={analyzing}>{analyzing ? "Analyzing…" : analysis ? "Analyze again" : "Analyze game"}</button>
            </div>}
            <ol className="moves">
              {room.game.moves.length === 0 ? <li>No moves yet.</li> : room.game.moves.map((move, index) => {
                const moveAnalysis = analysis?.moves[index];
                return <li key={`${move.san}-${index}`} className={replayIndex === index + 1 ? "active-move" : ""}><button onClick={() => setReplayIndex(index + 1)}><span>{Math.floor(index / 2) + 1}{index % 2 === 0 ? "." : "…"}</span>{move.san}{moveAnalysis && <small className={`move-label ${moveAnalysis.label}`}>{labelText(moveAnalysis.label)} · {evaluationText(moveAnalysis.evaluationCp)} · Best: {moveAnalysis.bestMoveSan}</small>}</button></li>;
              })}
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
