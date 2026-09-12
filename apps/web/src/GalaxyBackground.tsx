import { useEffect, useRef, useState } from "react";
import "./galaxy.css";

const TAU = Math.PI * 2;
const STAR_COLORS = ["#7dbfe6", "#dfedff", "#e99b61"];

/** A procedural star field: no image downloads or WebGL dependency. */
export function GalaxyBackground() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const elapsedRef = useRef(0);
  const viewRef = useRef({ yaw: 0, pitch: 0.58 });
  const resetRef = useRef<() => void>(() => {});
  const [paused, setPaused] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(() => window.matchMedia("(prefers-reduced-motion: reduce)").matches);

  useEffect(() => {
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReducedMotion(preference.matches);
    preference.addEventListener("change", update);
    return () => preference.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d", { alpha: false });
    if (!canvas || !context) return;

    let seed = 9417;
    const random = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    const spread = () => (random() + random() + random() - 1.5);
    const stars = Array.from({ length: window.innerWidth < 760 ? 3200 : 6500 }, (_, index) => {
      const core = index % 9 === 0;
      const halo = index % 11 === 0;
      const radius = core ? Math.pow(random(), 2) * 0.15 : Math.pow(random(), 0.7);
      const arm = index % 3;
      return {
        radius,
        angle: halo || core ? random() * TAU : arm * TAU / 3 + radius * 8.3 + spread() * (0.12 + radius * 0.2),
        offset: spread() * (core ? 0.08 : halo ? 0.28 : 0.025 + radius * 0.035),
        size: random() > 0.96 ? 1.8 + random() * 2.1 : 0.45 + random() * 1.05,
        alpha: 0.55 + random() * 0.45,
        phase: random() * TAU,
        color: random() > 0.83 ? 2 : random() > 0.52 ? 1 : 0,
      };
    });
    const distantStars = Array.from({ length: 180 }, () => ({ x: random(), y: random(), size: 0.4 + random() * 1.1, alpha: 0.1 + random() * 0.45 }));

    // Pre-render the bloom once; drawing cached sprites is cheaper than per-star shadows.
    const sprites = ["180,218,255", "238,247,255", "255,179,125"].map((color) => {
      const sprite = document.createElement("canvas");
      sprite.width = sprite.height = 48;
      const ctx = sprite.getContext("2d")!;
      const glow = ctx.createRadialGradient(24, 24, 0, 24, 24, 24);
      glow.addColorStop(0, "rgba(255,255,255,1)");
      glow.addColorStop(0.12, `rgba(${color},0.95)`);
      glow.addColorStop(0.25, `rgba(${color},0.3)`);
      glow.addColorStop(1, `rgba(${color},0)`);
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, 48, 48);
      return sprite;
    });

    let width = 0;
    let height = 0;
    let frame = 0;
    let lastTime = 0;
    let background: CanvasGradient;
    const moving = !paused && !reducedMotion;

    const draw = () => {
      const mobile = width < 760;
      const centerX = width * (mobile ? 0.49 : 0.32);
      const centerY = height * (mobile ? 0.27 : 0.51);
      const scale = mobile ? Math.min(width * 0.86, height * 0.51) : Math.min(width * 0.39, height * 0.65);
      const seconds = elapsedRef.current;
      const { yaw, pitch } = viewRef.current;
      const sinPitch = Math.sin(pitch);
      const cosPitch = Math.cos(pitch);
      const sinYaw = Math.sin(yaw);
      const cosYaw = Math.cos(yaw);
      context.globalAlpha = 1;
      context.globalCompositeOperation = "source-over";
      context.fillStyle = background;
      context.fillRect(0, 0, width, height);
      context.fillStyle = "#a8c5df";
      for (const star of distantStars) {
        context.globalAlpha = star.alpha;
        context.fillRect(star.x * width, star.y * height, star.size, star.size);
      }

      context.globalCompositeOperation = "lighter";
      for (const star of stars) {
        const angle = star.angle + seconds * 0.025;
        // Project a genuinely three-dimensional disk; dragging can reveal its thin edge.
        const x = Math.cos(angle) * star.radius;
        const y = Math.sin(angle) * star.radius;
        const tiltedY = y * cosPitch - star.offset * sinPitch;
        const tiltedZ = y * sinPitch + star.offset * cosPitch;
        const rotatedX = x * cosYaw + tiltedZ * sinYaw;
        const depth = -x * sinYaw + tiltedZ * cosYaw;
        const perspective = 3 / (3 - depth);
        const screenX = centerX + (rotatedX * 0.9 - tiltedY * 0.435) * scale * perspective;
        const screenY = centerY + (rotatedX * 0.435 + tiltedY * 0.9) * scale * perspective;
        const size = star.size * perspective * (mobile ? 0.8 : 1);
        context.globalAlpha = star.alpha * (0.78 + 0.22 * Math.sin(seconds * 0.65 + star.phase));
        if (star.size > 1.8) {
          const bloom = size * 10;
          context.drawImage(sprites[star.color]!, screenX - bloom / 2, screenY - bloom / 2, bloom, bloom);
          context.fillStyle = "#eff8ff";
          context.beginPath();
          context.arc(screenX, screenY, size * 0.62, 0, TAU);
          context.fill();
        } else {
          context.fillStyle = STAR_COLORS[star.color]!;
          context.fillRect(screenX, screenY, size, size);
        }
      }
      context.globalAlpha = 0.85;
      const core = scale * 0.38;
      context.drawImage(sprites[1]!, centerX - core / 2, centerY - core / 2, core, core);
      context.globalAlpha = 1;
      context.globalCompositeOperation = "source-over";
    };

    const resize = () => {
      width = canvas.clientWidth;
      height = canvas.clientHeight;
      const ratio = Math.min(window.devicePixelRatio || 1, 1.5);
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      background = context.createRadialGradient(width * 0.3, height * 0.5, 0, width * 0.3, height * 0.5, Math.max(width, height));
      background.addColorStop(0, "#0b121b");
      background.addColorStop(0.55, "#05090d");
      background.addColorStop(1, "#020508");
      draw();
    };
    const animate = (time: number) => {
      if (time - lastTime >= 1000 / 30) {
        elapsedRef.current += lastTime ? Math.min((time - lastTime) / 1000, 0.1) : 0;
        lastTime = time;
        draw();
      }
      frame = requestAnimationFrame(animate);
    };
    const visibility = () => {
      cancelAnimationFrame(frame);
      lastTime = 0;
      if (!document.hidden && moving) frame = requestAnimationFrame(animate);
    };
    let drag: { id: number; x: number; y: number } | null = null;
    const pointerDown = (event: PointerEvent) => {
      if (event.button !== 0 || drag) return;
      drag = { id: event.pointerId, x: event.clientX, y: event.clientY };
      canvas.setPointerCapture(event.pointerId);
      canvas.dataset.dragging = "true";
    };
    const pointerMove = (event: PointerEvent) => {
      if (!drag || drag.id !== event.pointerId) return;
      viewRef.current.yaw += (event.clientX - drag.x) * 0.006;
      viewRef.current.pitch = Math.max(-1.5, Math.min(1.5, viewRef.current.pitch + (event.clientY - drag.y) * 0.006));
      drag.x = event.clientX;
      drag.y = event.clientY;
      draw();
    };
    const pointerEnd = (event: PointerEvent) => {
      if (drag?.id !== event.pointerId) return;
      drag = null;
      delete canvas.dataset.dragging;
      if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    };
    const reset = () => {
      viewRef.current = { yaw: 0, pitch: 0.58 };
      elapsedRef.current = 0;
      draw();
    };
    const keyDown = (event: KeyboardEvent) => {
      if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home"].includes(event.key)) return;
      event.preventDefault();
      if (event.key === "Home") return reset();
      viewRef.current.yaw += event.key === "ArrowLeft" ? -0.15 : event.key === "ArrowRight" ? 0.15 : 0;
      viewRef.current.pitch = Math.max(-1.5, Math.min(1.5, viewRef.current.pitch + (event.key === "ArrowUp" ? -0.15 : event.key === "ArrowDown" ? 0.15 : 0)));
      draw();
    };
    resetRef.current = reset;
    canvas.addEventListener("pointerdown", pointerDown);
    canvas.addEventListener("pointermove", pointerMove);
    canvas.addEventListener("pointerup", pointerEnd);
    canvas.addEventListener("pointercancel", pointerEnd);
    canvas.addEventListener("lostpointercapture", pointerEnd);
    canvas.addEventListener("keydown", keyDown);
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    resize();
    document.addEventListener("visibilitychange", visibility);
    visibility();
    return () => {
      resetRef.current = () => {};
      if (drag && canvas.hasPointerCapture(drag.id)) canvas.releasePointerCapture(drag.id);
      delete canvas.dataset.dragging;
      canvas.removeEventListener("pointerdown", pointerDown);
      canvas.removeEventListener("pointermove", pointerMove);
      canvas.removeEventListener("pointerup", pointerEnd);
      canvas.removeEventListener("pointercancel", pointerEnd);
      canvas.removeEventListener("lostpointercapture", pointerEnd);
      canvas.removeEventListener("keydown", keyDown);
      cancelAnimationFrame(frame);
      observer.disconnect();
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [paused, reducedMotion]);

  return <>
    <div className="galaxy-background"><canvas ref={canvasRef} tabIndex={0} role="img" aria-label="Interactive spiral galaxy. Drag or use arrow keys to rotate. Press Home to reset the view." /></div>
    <div className="galaxy-controls">
    <span className="galaxy-hint">Drag the stars to explore</span>
    <div className="galaxy-actions">
    {!reducedMotion && <button className="galaxy-motion" type="button" onClick={() => setPaused(!paused)} aria-label={paused ? "Play galaxy animation" : "Pause galaxy animation"}>
      <span aria-hidden="true">{paused ? "▷" : "Ⅱ"}</span> {paused ? "Play animation" : "Pause animation"}
    </button>}
    <button className="galaxy-motion" type="button" onClick={() => resetRef.current()} aria-label="Reset galaxy view">↺ Reset view</button>
    </div>
    </div>
  </>;
}
