import { useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import type { ChessColor, RoomSnapshot } from "@chessss/shared";
import type { MagicScene } from "./MagicScene";
import { legalTargets, loadoutKey, parseLoadout, readPosition, skins, type Loadout, type Skin } from "./magicState";
import "./magic.css";

type Promotion = "q" | "r" | "b" | "n";
interface Props {
  room: RoomSnapshot;
  fen: string;
  view: ChessColor;
  readOnly: boolean;
  reviewing: boolean;
  selected: string | null;
  canMove: boolean;
  connected: boolean;
  notice: string;
  status: string;
  clocks: Record<ChessColor, string>;
  promotion: boolean;
  onSquare: (square: string) => void;
  onPromote: (piece: Promotion) => void;
  onCancelPromotion: () => void;
  onExit: () => void;
}
const names: Record<string, string> = { p: "Pawn", r: "Rook", n: "Knight", b: "Bishop", q: "Queen", k: "King" };
const icon: Record<string, string> = { p: "♟", r: "♜", n: "♞", b: "♝", q: "♛", k: "♚" };
export default function MagicMode(props: Props) {
  const { room, fen, view, readOnly, reviewing, selected, canMove, connected, notice, status, clocks, promotion, onSquare, onPromote, onCancelPromotion, onExit } = props;
  const dialog = useRef<HTMLDialogElement>(null);
  const host = useRef<HTMLDivElement>(null);
  const scene = useRef<MagicScene | null>(null);
  const latest = useRef(props); latest.current = props;
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [loadout, setLoadout] = useState<Loadout>(() => { try { return parseLoadout(localStorage.getItem(loadoutKey)); } catch { return parseLoadout(null); } });
  const [reduced, setReduced] = useState(() => window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  const [focused, setFocused] = useState<string | null>(null);
  const [keyboardSquare, setKeyboardSquare] = useState(view === "white" ? "e2" : "e7");
  const position = useMemo(() => readPosition(fen), [fen]);
  const targets = useMemo(() => canMove ? legalTargets(fen, selected) : [], [fen, selected, canMove]);
  const lastMove = reviewing ? null : room.lastMove;
  const checked = fen.split(" ")[1] === "w" ? "K" : "k";
  const checkSquare = !reviewing && room.game.isCheck ? [...position].find(([, symbol]) => symbol === checked)?.[0] ?? null : null;

  useEffect(() => {
    const modal = dialog.current!; const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow; document.body.style.overflow = "hidden"; modal.showModal();
    return () => { modal.close(); document.body.style.overflow = overflow; previous?.focus(); };
  }, []);
  useEffect(() => {
    let disposed = false;
    setReady(false); setFailed(false);
    import("./MagicScene").then(({ MagicScene }) => {
      if (disposed || !host.current) return;
      scene.current = new MagicScene(host.current, view, square => {
        const current = latest.current;
        if (current.canMove && current.connected && !current.readOnly && !current.promotion) current.onSquare(square);
      }, () => setFailed(true));
      setReady(true);
    }).catch(() => { if (!disposed) setFailed(true); });
    return () => { disposed = true; scene.current?.dispose(); scene.current = null; };
  }, [view]);
  useEffect(() => { if (ready) scene.current?.update(fen, lastMove, loadout, reduced); }, [ready, fen, lastMove, loadout, reduced]);
  useEffect(() => { if (ready) scene.current?.highlight(selected, targets, lastMove, checkSquare, focused); }, [ready, selected, targets, lastMove, checkSquare, focused]);
  useEffect(() => { try { localStorage.setItem(loadoutKey, JSON.stringify(loadout)); } catch { /* The current session remains usable without storage. */ } }, [loadout]);
  const files = view === "white" ? "abcdefgh" : "hgfedcba";
  const ranks = view === "white" ? "87654321" : "12345678";
  function keyboard(event: KeyboardEvent<HTMLButtonElement>, square: string) {
    const x = files.indexOf(square[0]), y = ranks.indexOf(square[1]);
    const offsets: Record<string, number[]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    const offset = offsets[event.key]; if (!offset) return;
    event.preventDefault();
    const next = `${files[Math.max(0, Math.min(7, x + offset[0]))]}${ranks[Math.max(0, Math.min(7, y + offset[1]))]}`;
    setKeyboardSquare(next); dialog.current?.querySelector<HTMLButtonElement>(`[data-square="${next}"]`)?.focus();
  }
  function playerCard(color: ChessColor) {
    const player = room.players.find(p => p.color === color);
    return <div className={`magic-player ${room.clock.activeColor === color ? "is-active" : ""}`}>
      <span className={`magic-avatar ${color}`} aria-hidden="true">♚</span>
      <div><strong>{player?.username ?? (player?.kind === "computer" ? "Computer" : "Waiting for player")}</strong><small>{color === "white" ? "WHITE" : "BLACK"} · {player?.kind === "computer" ? room.clock.activeColor === color ? "THINKING" : "COMPUTER" : player?.connected ? "CONNECTED" : "DISCONNECTED"}</small></div>
      <time className={clocks[color].startsWith("0:") ? "time-low" : ""}>{clocks[color]}</time>
    </div>;
  }
  const opponent = view === "white" ? "black" : "white";
  return createPortal(<dialog ref={dialog} className="magic-mode" aria-labelledby="magic-title" onCancel={event => { event.preventDefault(); if (promotion) onCancelPromotion(); else onExit(); }}>
    <div className="magic-shell">
      <header className="magic-header">
        <div className="magic-brand"><span className="magic-sigil" aria-hidden="true">✧</span><span>CHESSSS <b>/</b> MAGIC</span><span className="magic-beta">2.5D EXPERIENCE</span></div>
        <button className="magic-exit" onClick={onExit}>↗ <span>Exit Magic · 退出</span><kbd>esc</kbd></button>
      </header>
      <div className="magic-content">
        <section className="magic-arena" aria-label="Immersive chess arena">
          <div className="magic-scene-title"><p>THE ASTRAL CHAMBER</p><h1 id="magic-title">A little beyond ordinary.</h1><span>{readOnly ? "SPECTATOR" : reviewing ? "REVIEW POSITION" : room.mode === "computer" ? "HUMAN VS COMPUTER" : "LIVE MATCH"} <i>✦</i> ROOM {room.id}</span></div>
          <div className="magic-opponent">{playerCard(opponent)}</div>
          <div className="magic-canvas" ref={host} />
          <div className="magic-keyboard-board" role="group" aria-label="Magic chess board. Arrow keys navigate, Enter selects a square.">
            {[...ranks].flatMap(rank => [...files].map(file => {
              const square = `${file}${rank}`; const symbol = position.get(square);
              return <button key={square} data-square={square} tabIndex={square === keyboardSquare ? 0 : -1} aria-label={`${square}${symbol ? ` ${symbol === symbol.toUpperCase() ? "White" : "Black"} ${names[symbol.toLowerCase()]}` : " empty"}${targets.includes(square) ? ", legal destination" : ""}`} aria-pressed={selected === square} aria-disabled={!canMove || !connected || readOnly || promotion} onFocus={() => setFocused(square)} onBlur={() => setFocused(null)} onKeyDown={event => keyboard(event, square)} onClick={() => { if (canMove && connected && !readOnly && !promotion) onSquare(square); }}>{square}</button>;
            }))}
          </div>
          <div className="magic-self">{playerCard(view)}</div>
          <div className="magic-instruction">{focused ? `Keyboard · ${focused.toUpperCase()} · Arrow keys to navigate, Enter to select` : selected ? `${names[position.get(selected)?.toLowerCase() ?? "p"]} ${selected.toUpperCase()} selected · choose a glowing destination` : readOnly || reviewing ? "Enjoy the position. Exit Magic to access replay and analysis." : "Select a piece. Make your move. Let the magic unfold."}</div>
          {!ready && !failed && <div className="magic-loading" role="status"><span>✧</span>Opening the chamber…</div>}
          {failed && <div className="magic-loading" role="alert"><span>✧</span><strong>The 3D scene is unavailable on this device.</strong><p>Your game is still running. Return to the standard board to continue.</p><button onClick={onExit}>Return to standard board</button></div>}
          {promotion && <div className="magic-promotion" role="group" aria-label="Choose promotion piece"><p>AN ASCENSION</p><h2>Choose your new power.</h2><div>{(["q", "r", "b", "n"] as const).map(piece => <button key={piece} onClick={() => onPromote(piece)} aria-label={`Promote to ${names[piece]}`}><span>{icon[piece]}</span>{names[piece]}</button>)}</div><button className="magic-promotion-cancel" onClick={onCancelPromotion}>Cancel</button></div>}
        </section>
        <aside className="magic-sidebar">
          <div className="magic-side-heading"><span>01 / THE COLLECTION</span><h2>Choose your<br /><em>alter ego.</em></h2><p>Two sides. Three worlds.<br />Make this board your own.</p></div>
          {(["white", "black"] as ChessColor[]).map(color => <fieldset className="magic-loadout" key={color}><legend><span className={`magic-side-dot ${color}`} />{color === "white" ? "WHITE PIECES / 白方" : "BLACK PIECES / 黑方"}</legend>
            {(Object.keys(skins) as Skin[]).map(skin => <button key={skin} className={`magic-skin ${loadout[color] === skin ? "chosen" : ""}`} aria-pressed={loadout[color] === skin} aria-label={`${color} ${skins[skin].name} skin`} style={{ "--skin-color": skins[skin][color] } as CSSProperties} onClick={() => setLoadout(current => ({ ...current, [color]: skin }))}>
              <span className={`magic-skin-preview ${skin}`} aria-hidden="true">{skin === "astral" ? "♝" : skin === "sovereign" ? "♛" : "♜"}</span><span><strong>{skins[skin].name}</strong><small>{skins[skin].subtitle}</small></span><span className="magic-radio" />
            </button>)}
          </fieldset>)}
          <label className="magic-motion"><input type="checkbox" checked={!reduced} onChange={event => setReduced(!event.target.checked)} /><span>Motion & effects<small>走子动画与粒子特效</small></span><span className="magic-switch" /></label>
          <p className="magic-lock">⌑ <span>Stay in the game.<br />退出 Magic 后可使用复盘等其他功能。</span></p>
        </aside>
      </div>
      <footer className="magic-footer"><span className={`magic-live ${connected ? "online" : "offline"}`}>{connected ? readOnly ? "SPECTATING" : "CONNECTED" : "RECONNECTING"}</span><div role="status" className={checkSquare ? "magic-check" : ""}>{!connected ? "Connection lost — reconnecting. Moves are temporarily unavailable." : reviewing ? `Historical position · ${fen.split(" ")[1] === "w" ? "White" : "Black"} to move · clocks show the live game` : status}</div><span className="magic-footer-note">{readOnly ? "READ-ONLY SPECTATOR" : notice || "YOUR NEXT MOVE IS A LITTLE MAGIC."}</span></footer>
    </div>
  </dialog>, document.body);
}
