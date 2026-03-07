"use client";

interface ScoreRingProps {
  score: number;  // 1-10
  size?: "sm" | "md" | "lg";
  label?: string;
}

const SIZE_MAP = {
  sm: { r: 22, stroke: 4, fontSize: "text-sm", wh: "w-14 h-14" },
  md: { r: 30, stroke: 5, fontSize: "text-xl", wh: "w-20 h-20" },
  lg: { r: 42, stroke: 6, fontSize: "text-3xl", wh: "w-28 h-28" },
};

function scoreColor(score: number): string {
  if (score >= 9) return "#22c55e"; // green-500
  if (score >= 7) return "#3b82f6"; // blue-500
  if (score >= 5) return "#f59e0b"; // amber-500
  if (score >= 3) return "#f97316"; // orange-500
  return "#ef4444"; // red-500
}

function scoreLabel(score: number): string {
  if (score >= 9) return "Excellent";
  if (score >= 7) return "Good";
  if (score >= 5) return "Fair";
  if (score >= 3) return "Poor";
  return "Critical";
}

export default function ScoreRing({ score, size = "md", label }: ScoreRingProps) {
  const { r, stroke, fontSize, wh } = SIZE_MAP[size];
  const cx = r + stroke;
  const cy = r + stroke;
  const circumference = 2 * Math.PI * r;
  const progress = Math.max(0, Math.min(10, score)) / 10;
  const dashOffset = circumference * (1 - progress);
  const color = scoreColor(score);

  return (
    <div className="flex flex-col items-center gap-1">
      <div className={`relative ${wh}`}>
        <svg
          className="w-full h-full -rotate-90"
          viewBox={`0 0 ${cx * 2} ${cy * 2}`}
        >
          {/* Track */}
          <circle
            cx={cx}
            cy={cy}
            r={r}
            fill="none"
            stroke="#e5e7eb"
            strokeWidth={stroke}
          />
          {/* Progress */}
          <circle
            cx={cx}
            cy={cy}
            r={r}
            fill="none"
            stroke={color}
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={dashOffset}
            style={{ transition: "stroke-dashoffset 0.5s ease" }}
          />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          <span className={`font-bold ${fontSize}`} style={{ color }}>
            {score}
          </span>
        </div>
      </div>
      {label && (
        <span className="text-xs font-medium text-gray-500 text-center">{label}</span>
      )}
      {!label && (
        <span className="text-xs font-medium" style={{ color }}>
          {scoreLabel(score)}
        </span>
      )}
    </div>
  );
}
