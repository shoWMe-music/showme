import React from "react";

/**
 * BreathingGlow — slow-pulsing coral glow behind hero logos.
 */
export function BreathingGlow({ className = "" }: { className?: string }) {
  return (
    <div
      className={`absolute inset-0 -m-8 rounded-full bg-primary/20 blur-3xl animate-breathe-slow pointer-events-none ${className}`}
      aria-hidden
    />
  );
}

/**
 * FloatingShapes — drifting geometric shapes in coral/muted tones.
 */
const shapeConfigs = [
  { size: 80, x: "10%", y: "15%", dur: "22s", delay: "0s", shape: "rounded-full", color: "bg-primary/[0.06]" },
  { size: 60, x: "75%", y: "25%", dur: "28s", delay: "-5s", shape: "rounded-xl", color: "bg-primary/[0.05]" },
  { size: 100, x: "85%", y: "70%", dur: "25s", delay: "-12s", shape: "rounded-full", color: "bg-primary/[0.04]" },
  { size: 50, x: "20%", y: "80%", dur: "20s", delay: "-8s", shape: "rounded-lg", color: "bg-muted-foreground/[0.04]" },
  { size: 70, x: "50%", y: "10%", dur: "30s", delay: "-3s", shape: "rounded-full", color: "bg-primary/[0.05]" },
  { size: 45, x: "60%", y: "60%", dur: "18s", delay: "-15s", shape: "rounded-xl", color: "bg-muted-foreground/[0.03]" },
];

export function FloatingShapes({ className = "" }: { className?: string }) {
  return (
    <div className={`absolute inset-0 overflow-hidden pointer-events-none ${className}`} aria-hidden>
      {shapeConfigs.map((s, i) => (
        <div
          key={i}
          className={`absolute ${s.shape} ${s.color} blur-xl`}
          style={{
            width: s.size,
            height: s.size,
            left: s.x,
            top: s.y,
            animation: `float-drift-${(i % 3) + 1} ${s.dur} ease-in-out infinite`,
            animationDelay: s.delay,
          }}
        />
      ))}
    </div>
  );
}

/**
 * AnimatedGradient — shifting gradient for dark sections.
 */
export function AnimatedGradient({ className = "" }: { className?: string }) {
  return (
    <div
      className={`absolute inset-0 pointer-events-none opacity-30 ${className}`}
      style={{
        background:
          "radial-gradient(ellipse at 30% 20%, hsl(var(--primary) / 0.15), transparent 60%), radial-gradient(ellipse at 70% 80%, hsl(var(--primary) / 0.1), transparent 60%)",
        animation: "gradient-shift 12s ease-in-out infinite alternate",
      }}
      aria-hidden
    />
  );
}

/**
 * FloatingParticles — small dots with slow drift, low opacity.
 */
export function FloatingParticles({
  count = 20,
  className = "",
}: {
  count?: number;
  className?: string;
}) {
  const particles = React.useMemo(
    () =>
      Array.from({ length: count }, (_, i) => ({
        x: `${(i * 37 + 13) % 100}%`,
        y: `${(i * 53 + 7) % 100}%`,
        size: 2 + (i % 3),
        dur: `${15 + (i % 10) * 2}s`,
        delay: `${-(i * 1.3)}s`,
        variant: (i % 3) + 1,
      })),
    [count]
  );

  return (
    <div className={`absolute inset-0 overflow-hidden pointer-events-none ${className}`} aria-hidden>
      {particles.map((p, i) => (
        <div
          key={i}
          className="absolute rounded-full bg-primary/[0.12]"
          style={{
            width: p.size,
            height: p.size,
            left: p.x,
            top: p.y,
            animation: `particle-float-${p.variant} ${p.dur} ease-in-out infinite`,
            animationDelay: p.delay,
          }}
        />
      ))}
    </div>
  );
}
