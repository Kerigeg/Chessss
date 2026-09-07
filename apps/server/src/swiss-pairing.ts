import type { ChessColor, TournamentParticipant } from "@chessss/shared";

export interface SwissPairingDraft {
  white?: string;
  black?: string;
  bye?: string;
}

function comparePlayers(left: TournamentParticipant, right: TournamentParticipant) {
  return right.score - left.score
    || right.buchholz - left.buchholz
    || right.wins - left.wins
    || left.seed - right.seed
    || left.username.localeCompare(right.username);
}

function colorCost(player: TournamentParticipant, color: ChessColor): number {
  const whiteCount = player.colorHistory.filter((value) => value === "white").length;
  const blackCount = player.colorHistory.length - whiteCount;
  const imbalance = color === "white" ? whiteCount - blackCount : blackCount - whiteCount;
  const repeatedTwice = player.colorHistory.slice(-2).every((value) => value === color) && player.colorHistory.length >= 2;
  return Math.max(0, imbalance) * 3 + (repeatedTwice ? 100 : 0);
}

function orient(left: TournamentParticipant, right: TournamentParticipant): SwissPairingDraft {
  const normal = colorCost(left, "white") + colorCost(right, "black");
  const reversed = colorCost(left, "black") + colorCost(right, "white");
  if (normal < reversed || (normal === reversed && left.seed <= right.seed)) return { white: left.username, black: right.username };
  return { white: right.username, black: left.username };
}

/** Deterministic, score-group-aware greedy/backtracking Swiss pairer for 4–32 players. */
export function createSwissPairings(participants: TournamentParticipant[]): SwissPairingDraft[] {
  const active = participants.filter((player) => !player.withdrawn && !player.disqualified).sort(comparePlayers);
  const drafts: SwissPairingDraft[] = [];
  if (active.length % 2 === 1) {
    const bye = [...active].reverse().find((player) => !player.byeReceived) ?? active.at(-1);
    if (bye) {
      drafts.push({ bye: bye.username });
      active.splice(active.indexOf(bye), 1);
    }
  }

  const search = (remaining: TournamentParticipant[]): SwissPairingDraft[] | null => {
    if (!remaining.length) return [];
    const first = remaining[0]!;
    const candidates = remaining.slice(1).sort((left, right) => {
      const leftRepeat = first.opponentHistory.some((name) => name.toLowerCase() === left.username.toLowerCase()) ? 1 : 0;
      const rightRepeat = first.opponentHistory.some((name) => name.toLowerCase() === right.username.toLowerCase()) ? 1 : 0;
      return leftRepeat - rightRepeat || Math.abs(first.score - left.score) - Math.abs(first.score - right.score) || comparePlayers(left, right);
    });
    for (const opponent of candidates) {
      if (first.opponentHistory.some((name) => name.toLowerCase() === opponent.username.toLowerCase())) continue;
      const tail = search(remaining.filter((player) => player !== first && player !== opponent));
      if (tail) return [orient(first, opponent), ...tail];
    }
    return null;
  };

  const withoutRepeats = search(active);
  if (withoutRepeats) return [...drafts, ...withoutRepeats];

  // In a late round, a repeat can become mathematically unavoidable. Keep the fallback deterministic.
  while (active.length >= 2) {
    const first = active.shift()!;
    const opponent = active.sort((left, right) => Math.abs(first.score - left.score) - Math.abs(first.score - right.score) || comparePlayers(left, right)).shift()!;
    drafts.push(orient(first, opponent));
  }
  return drafts;
}
