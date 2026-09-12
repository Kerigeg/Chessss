export interface GalaxyParticleMotion {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

export interface GalaxyHoverStroke {
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
}

/** Apply a soft brush along the entire pointer segment, including between frames. */
export function disturbGalaxyParticle(motion: GalaxyParticleMotion, x: number, y: number, stroke: GalaxyHoverStroke, radius: number) {
  const dx = stroke.toX - stroke.fromX;
  const dy = stroke.toY - stroke.fromY;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared < 0.01 || radius <= 0) return;
  const along = Math.max(0, Math.min(1, ((x - stroke.fromX) * dx + (y - stroke.fromY) * dy) / lengthSquared));
  const awayX = x - (stroke.fromX + dx * along);
  const awayY = y - (stroke.fromY + dy * along);
  const distanceSquared = awayX * awayX + awayY * awayY;
  if (distanceSquared >= radius * radius) return;

  const distance = Math.sqrt(distanceSquared);
  const length = Math.sqrt(lengthSquared);
  const directionX = dx / length;
  const directionY = dy / length;
  const normalX = distance > 0.01 ? awayX / distance : -directionY;
  const normalY = distance > 0.01 ? awayY / distance : directionX;
  const falloff = 1 - distance / radius;
  const impulse = Math.min(length, 45) * 13 * falloff * falloff;
  // A little sideways curl breaks up the wake without moving the whole galaxy.
  motion.vx += (directionX + normalX * 0.65 - normalY * 0.2) * impulse;
  motion.vy += (directionY + normalY * 0.65 + normalX * 0.2) * impulse;
  const speed = Math.hypot(motion.vx, motion.vy);
  if (speed > 850) { motion.vx *= 850 / speed; motion.vy *= 850 / speed; }
}

/** A damped spring returns each particle to its continuously projected position. */
export function advanceGalaxyParticle(motion: GalaxyParticleMotion, delta: number) {
  if (!(motion.x || motion.y || motion.vx || motion.vy) || delta <= 0) return;
  const duration = Math.min(delta, 0.1);
  const steps = Math.ceil(duration * 120);
  const dt = duration / steps;
  for (let step = 0; step < steps; step++) {
    motion.vx += (-60 * motion.x - 11 * motion.vx) * dt;
    motion.vy += (-60 * motion.y - 11 * motion.vy) * dt;
    motion.x += motion.vx * dt;
    motion.y += motion.vy * dt;
  }
  if (Math.abs(motion.x) + Math.abs(motion.y) < 0.04 && Math.abs(motion.vx) + Math.abs(motion.vy) < 0.1) {
    motion.x = motion.y = motion.vx = motion.vy = 0;
  }
}

/** A bounded trail prevents stale entries and large jumps across the login form. */
export class GalaxyHoverTrail {
  private previous: { x: number; y: number; time: number } | null = null;
  private strokes: GalaxyHoverStroke[] = [];

  move(x: number, y: number, time: number) {
    const previous = this.previous;
    this.previous = { x, y, time };
    if (!previous || time - previous.time > 120) { this.strokes = []; return; }
    // Coalesce adjacent samples within a rendered frame to avoid event-rate-dependent strength.
    const last = this.strokes.at(-1);
    if (last && Math.hypot(last.toX - last.fromX, last.toY - last.fromY) < 24) {
      last.toX = x;
      last.toY = y;
    } else {
      this.strokes.push({ fromX: previous.x, fromY: previous.y, toX: x, toY: y });
      if (this.strokes.length > 12) this.strokes.shift();
    }
  }

  consume() {
    const strokes = this.strokes;
    this.strokes = [];
    return strokes;
  }

  clear() { this.previous = null; this.strokes = []; }
}
