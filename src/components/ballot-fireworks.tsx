"use client";

import { useEffect, useRef } from "react";

type Spark = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  color: string;
  size: number;
};

/**
 * A short burst behind the winning row, then it stops. The outline is what
 * remains; this is only the moment the ballot closed. Squares, not circles:
 * the same mark the rest of the site uses. Reduced motion skips it entirely.
 */
export function BallotFireworks() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      return;
    }

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const style = getComputedStyle(canvas);
    const colors = [
      style.getPropertyValue("--brand").trim() || "#6b8072",
      style.getPropertyValue("--ink").trim() || "#2a2a28",
      "#c4a574",
    ];

    const sparks: Spark[] = [];
    let frame = 0;
    let running = true;

    const size = () => {
      const parent = canvas.parentElement;
      if (!parent) return { w: 0, h: 0 };
      return { w: parent.offsetWidth, h: parent.offsetHeight };
    };

    const resize = () => {
      const { w, h } = size();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.max(1, w) * dpr;
      canvas.height = Math.max(1, h) * dpr;
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const burst = (x: number, y: number) => {
      for (let i = 0; i < 46; i += 1) {
        const angle = (Math.PI * 2 * i) / 46 + Math.random() * 0.35;
        const speed = 1.1 + Math.random() * 3.4;
        sparks.push({
          x,
          y,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed - 0.7,
          life: 0,
          max: 36 + Math.random() * 28,
          color: colors[i % colors.length]!,
          size: 1.2 + Math.random() * 1.7,
        });
      }
    };

    resize();
    const observer = new ResizeObserver(resize);
    if (canvas.parentElement) observer.observe(canvas.parentElement);

    const { w, h } = size();
    burst(w * 0.22, h * 0.42);
    const later = [
      window.setTimeout(() => {
        const next = size();
        burst(next.w * 0.78, next.h * 0.32);
      }, 420),
      window.setTimeout(() => {
        const next = size();
        burst(next.w * 0.5, next.h * 0.58);
      }, 980),
    ];

    const tick = () => {
      if (!running) return;
      const { w: width, h: height } = size();
      ctx.clearRect(0, 0, width, height);
      for (let i = sparks.length - 1; i >= 0; i -= 1) {
        const spark = sparks[i]!;
        spark.life += 1;
        spark.x += spark.vx;
        spark.y += spark.vy;
        spark.vy += 0.032;
        spark.vx *= 0.99;
        const t = spark.life / spark.max;
        if (t >= 1) {
          sparks.splice(i, 1);
          continue;
        }
        ctx.globalAlpha = 1 - t;
        ctx.fillStyle = spark.color;
        ctx.fillRect(spark.x, spark.y, spark.size, spark.size);
      }
      ctx.globalAlpha = 1;
      if (sparks.length === 0 && frame > 90) {
        running = false;
        return;
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);

    return () => {
      running = false;
      cancelAnimationFrame(frame);
      for (const id of later) window.clearTimeout(id);
      observer.disconnect();
    };
  }, []);

  return <canvas ref={canvasRef} className="ballot-fireworks" aria-hidden />;
}
