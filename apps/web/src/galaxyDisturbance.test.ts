import { describe, expect, it } from "vitest";
import { advanceGalaxyParticle, disturbGalaxyParticle, GalaxyHoverTrail } from "./galaxyDisturbance";

const resting = () => ({ x: 0, y: 0, vx: 0, vy: 0 });
const stroke = { fromX: 0, fromY: 0, toX: 400, toY: 0 };

describe("galaxy hover disturbance", () => {
  it("stirs stars between fast pointer samples, with a soft local falloff", () => {
    const center = resting();
    const edge = resting();
    const outside = resting();
    disturbGalaxyParticle(center, 200, 0, stroke, 100);
    disturbGalaxyParticle(edge, 200, 80, stroke, 100);
    disturbGalaxyParticle(outside, 200, 101, stroke, 100);
    expect(center.vx).toBeGreaterThan(0);
    expect(Math.hypot(edge.vx, edge.vy)).toBeLessThan(Math.hypot(center.vx, center.vy));
    expect(outside).toEqual(resting());
  });

  it("does not add energy for a stationary pointer", () => {
    const motion = resting();
    disturbGalaxyParticle(motion, 0, 0, { fromX: 0, fromY: 0, toX: 0, toY: 0 }, 100);
    expect(motion).toEqual(resting());
  });

  it("caps repeated impulses and settles back after the pointer leaves", () => {
    const motion = resting();
    for (let i = 0; i < 100; i++) disturbGalaxyParticle(motion, 200, 0, stroke, 100);
    expect(Math.hypot(motion.vx, motion.vy)).toBeLessThanOrEqual(850.00001);
    advanceGalaxyParticle(motion, 1 / 30);
    expect(motion.x).toBeGreaterThan(0);
    for (let i = 0; i < 150; i++) advanceGalaxyParticle(motion, 1 / 30);
    expect(motion).toEqual(resting());
  });

  it("recovers consistently at different frame rates without a long-frame jump", () => {
    const run = (fps: number) => {
      const motion = { x: 0, y: 0, vx: 600, vy: 250 };
      for (let i = 0; i < fps; i++) advanceGalaxyParticle(motion, 1 / fps);
      return motion;
    };
    expect(run(30).x).toBeCloseTo(run(60).x, 6);
    const motion = { x: 10, y: 20, vx: 600, vy: 250 };
    const normal = { ...motion };
    advanceGalaxyParticle(motion, 30);
    advanceGalaxyParticle(normal, 0.1);
    expect(motion).toEqual(normal);
  });
});

describe("galaxy hover trail", () => {
  it("anchors entry and consumes each movement only once", () => {
    const trail = new GalaxyHoverTrail();
    trail.move(10, 20, 0);
    expect(trail.consume()).toEqual([]);
    trail.move(30, 40, 16);
    expect(trail.consume()).toEqual([{ fromX: 10, fromY: 20, toX: 30, toY: 40 }]);
    expect(trail.consume()).toEqual([]);
  });

  it("does not draw a path across a leave, drag, or stale interval", () => {
    const trail = new GalaxyHoverTrail();
    trail.move(0, 0, 0);
    trail.move(10, 0, 16);
    trail.clear();
    trail.move(500, 0, 32);
    expect(trail.consume()).toEqual([]);
    trail.move(510, 0, 48);
    trail.move(900, 0, 500);
    expect(trail.consume()).toEqual([]);
    trail.move(910, 0, 516);
    expect(trail.consume()).toEqual([{ fromX: 900, fromY: 0, toX: 910, toY: 0 }]);
  });

  it("coalesces dense samples and bounds the work queued between frames", () => {
    const trail = new GalaxyHoverTrail();
    for (let i = 0; i <= 10; i++) trail.move(i, 0, i);
    expect(trail.consume()).toEqual([{ fromX: 0, fromY: 0, toX: 10, toY: 0 }]);
    for (let i = 0; i < 100; i++) trail.move(i * 30, 0, 20 + i);
    expect(trail.consume().length).toBeLessThanOrEqual(12);
  });
});
