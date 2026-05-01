"use client";
import { useRef, useEffect } from "react";

export default function CrashGraph({ gameState, multiplier, crashPoint }) {
  const canvasRef = useRef(null);
  const pointsRef = useRef([]);

  useEffect(() => {
    if (gameState === "waiting") {
      pointsRef.current = [];
    }
    if (gameState === "running" || gameState === "crashed") {
      pointsRef.current.push(multiplier);
      if (pointsRef.current.length > 300) pointsRef.current.shift();
    }
    draw();
  }, [multiplier, gameState]);

  function draw() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx  = canvas.getContext("2d");
    const W    = canvas.width;
    const H    = canvas.height;
    const pts  = pointsRef.current;

    ctx.clearRect(0, 0, W, H);

    // Background grid
    ctx.strokeStyle = "rgba(42,42,58,0.6)";
    ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i++) {
      const y = (H * i) / 4;
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
    }
    for (let i = 0; i <= 6; i++) {
      const x = (W * i) / 6;
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
    }

    if (pts.length < 2) return;

    const maxMul = Math.max(...pts, 1.5);
    const minMul = 1.00;

    function toX(i) { return (i / (pts.length - 1)) * W; }
    function toY(m) {
      const norm = (m - minMul) / (maxMul - minMul);
      return H - norm * H * 0.85 - H * 0.05;
    }

    const crashed = gameState === "crashed";
    const lineColor  = crashed ? "#ef4444" : "#F5A623";
    const glowColor  = crashed ? "rgba(239,68,68,0.3)" : "rgba(245,166,35,0.3)";

    // Gradient fill under curve
    const grad = ctx.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, crashed ? "rgba(239,68,68,0.2)" : "rgba(245,166,35,0.15)");
    grad.addColorStop(1, "rgba(0,0,0,0)");

    ctx.beginPath();
    ctx.moveTo(toX(0), H);
    for (let i = 0; i < pts.length; i++) {
      ctx.lineTo(toX(i), toY(pts[i]));
    }
    ctx.lineTo(toX(pts.length - 1), H);
    ctx.closePath();
    ctx.fillStyle = grad;
    ctx.fill();

    // Glow line
    ctx.beginPath();
    ctx.moveTo(toX(0), toY(pts[0]));
    for (let i = 1; i < pts.length; i++) ctx.lineTo(toX(i), toY(pts[i]));
    ctx.strokeStyle = glowColor;
    ctx.lineWidth = 8;
    ctx.lineJoin = "round";
    ctx.stroke();

    // Main line
    ctx.beginPath();
    ctx.moveTo(toX(0), toY(pts[0]));
    for (let i = 1; i < pts.length; i++) ctx.lineTo(toX(i), toY(pts[i]));
    ctx.strokeStyle = lineColor;
    ctx.lineWidth = 3;
    ctx.stroke();

    // Dot at current position
    if (!crashed) {
      const lx = toX(pts.length - 1);
      const ly = toY(pts[pts.length - 1]);
      ctx.beginPath();
      ctx.arc(lx, ly, 6, 0, Math.PI * 2);
      ctx.fillStyle = lineColor;
      ctx.fill();
      ctx.beginPath();
      ctx.arc(lx, ly, 10, 0, Math.PI * 2);
      ctx.fillStyle = glowColor;
      ctx.fill();
    }

    // Multiplier labels on Y axis
    ctx.fillStyle = "rgba(90,90,110,0.8)";
    ctx.font = "11px JetBrains Mono, monospace";
    ctx.textAlign = "left";
    for (let i = 1; i <= 4; i++) {
      const m = minMul + (maxMul - minMul) * (i / 4);
      const y = toY(m);
      ctx.fillText(`${m.toFixed(2)}×`, 6, y - 4);
    }
  }

  return (
    <canvas
      ref={canvasRef}
      width={700}
      height={280}
      className="w-full h-full"
      style={{ imageRendering: "crisp-edges" }}
    />
  );
}
