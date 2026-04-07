/** Lightweight canvas confetti burst. Self-cleans after the animation. */
export const fireConfetti = (opts?: { x?: number; y?: number }) => {
  const canvas = document.createElement("canvas");
  canvas.style.cssText =
    "position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:9999";
  document.body.appendChild(canvas);

  const ctx = canvas.getContext("2d");
  if (!ctx) {
    canvas.remove();
    return;
  }

  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;

  const originX = opts?.x ?? canvas.width / 2;
  const originY = opts?.y ?? canvas.height * 0.35;

  const PARTICLE_COUNT = 60;
  const GRAVITY = 0.12;
  const COLOURS = [
    "#22c55e",
    "#eab308",
    "#ef4444",
    "#3b82f6",
    "#a855f7",
    "#ec4899",
    "#f97316",
    "#14b8a6",
  ];

  type Particle = {
    x: number;
    y: number;
    vx: number;
    vy: number;
    colour: string;
    size: number;
    rotation: number;
    rotationSpeed: number;
    life: number;
    decay: number;
    shape: "rect" | "circle";
  };

  const particles: Particle[] = Array.from({ length: PARTICLE_COUNT }, () => {
    const angle = Math.random() * Math.PI * 2;
    const speed = 4 + Math.random() * 8;
    return {
      x: originX,
      y: originY,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - 4,
      colour: COLOURS[Math.floor(Math.random() * COLOURS.length)],
      size: 3 + Math.random() * 5,
      rotation: Math.random() * Math.PI * 2,
      rotationSpeed: (Math.random() - 0.5) * 0.3,
      life: 1,
      decay: 0.008 + Math.random() * 0.008,
      shape: Math.random() > 0.5 ? "rect" : "circle",
    };
  });

  let raf = 0;

  const draw = () => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    let alive = false;

    for (const p of particles) {
      if (p.life <= 0) continue;
      alive = true;

      p.x += p.vx;
      p.y += p.vy;
      p.vy += GRAVITY;
      p.vx *= 0.99;
      p.rotation += p.rotationSpeed;
      p.life -= p.decay;

      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rotation);
      ctx.globalAlpha = Math.max(0, p.life);
      ctx.fillStyle = p.colour;

      if (p.shape === "rect") {
        ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.6);
      } else {
        ctx.beginPath();
        ctx.arc(0, 0, p.size / 2, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.restore();
    }

    if (alive) {
      raf = requestAnimationFrame(draw);
    } else {
      canvas.remove();
    }
  };

  raf = requestAnimationFrame(draw);

  // Safety cleanup
  setTimeout(() => {
    cancelAnimationFrame(raf);
    canvas.remove();
  }, 4000);
};
