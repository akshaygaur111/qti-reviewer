import type { Severity } from "@/lib/types";

const BADGE_STYLES: Record<Severity, string> = {
  critical: "bg-red-100 text-red-800 border border-red-200",
  major: "bg-orange-100 text-orange-800 border border-orange-200",
  minor: "bg-yellow-100 text-yellow-800 border border-yellow-200",
  suggestion: "bg-blue-100 text-blue-800 border border-blue-200",
};

const ICONS: Record<Severity, string> = {
  critical: "🔴",
  major: "🟠",
  minor: "🟡",
  suggestion: "🔵",
};

export default function SeverityBadge({ severity }: { severity: Severity }) {
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold ${BADGE_STYLES[severity]}`}>
      <span>{ICONS[severity]}</span>
      {severity.charAt(0).toUpperCase() + severity.slice(1)}
    </span>
  );
}
