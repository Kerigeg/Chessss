import type { GameAccess } from "@chessss/shared";

export interface MatchmakingTicket {
  socketId: string;
  username: string;
  access: GameAccess;
  initialTimeMs: number;
  joinedAt: number;
}

export type MatchmakingJoinResult =
  | { status: "queued"; ticket: MatchmakingTicket }
  | { status: "matched"; first: MatchmakingTicket; second: MatchmakingTicket };

export class MatchmakingError extends Error {}

export class MatchmakingService {
  private readonly tickets = new Map<string, MatchmakingTicket>();

  join(ticket: MatchmakingTicket): MatchmakingJoinResult {
    if (this.tickets.has(ticket.socketId)) throw new MatchmakingError("You are already searching for an opponent.");
    if ([...this.tickets.values()].some((candidate) => candidate.username.toLowerCase() === ticket.username.toLowerCase())) throw new MatchmakingError("This account is already searching for an opponent.");
    const opponent = [...this.tickets.values()]
      .filter((candidate) => candidate.access === ticket.access && candidate.initialTimeMs === ticket.initialTimeMs && candidate.username.toLowerCase() !== ticket.username.toLowerCase())
      .sort((left, right) => left.joinedAt - right.joinedAt || left.socketId.localeCompare(right.socketId))[0];
    if (!opponent) {
      this.tickets.set(ticket.socketId, { ...ticket });
      return { status: "queued", ticket: { ...ticket } };
    }
    this.tickets.delete(opponent.socketId);
    return { status: "matched", first: { ...opponent }, second: { ...ticket } };
  }

  cancel(socketId: string): boolean { return this.tickets.delete(socketId); }
  waitingCount(): number { return this.tickets.size; }
}
