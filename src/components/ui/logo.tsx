import { cn } from "@/lib/utils";

interface LogoProps {
  className?: string;
  size?: "sm" | "md" | "lg";
  showText?: boolean;
}

const sizes = {
  sm: { svg: "size-7", text: "text-lg" },
  md: { svg: "size-9", text: "text-xl" },
  lg: { svg: "size-14", text: "text-3xl" },
};

/**
 * Ayus — "life / longevity" (root of Ayurveda).
 * Mark: a leaf-heart hybrid with a pulse wave. Green-to-teal gradient evokes
 * both the Ayurvedic leaf and clinical rigor.
 */
export function Logo({ className, size = "md", showText = true }: LogoProps) {
  const s = sizes[size];

  return (
    <div className={cn("flex items-center gap-2.5", className)}>
      <svg
        viewBox="0 0 48 48"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className={cn(s.svg, "shrink-0")}
        aria-hidden="true"
      >
        <defs>
          <linearGradient id="ayus-bg" x1="0" y1="0" x2="48" y2="48">
            <stop offset="0%" stopColor="hsl(160 70% 38%)" />
            <stop offset="100%" stopColor="hsl(180 65% 42%)" />
          </linearGradient>
          <linearGradient id="ayus-shine" x1="0" y1="0" x2="48" y2="48">
            <stop offset="0%" stopColor="white" stopOpacity="0.28" />
            <stop offset="100%" stopColor="white" stopOpacity="0" />
          </linearGradient>
        </defs>

        {/* Rounded square background */}
        <rect width="48" height="48" rx="12" fill="url(#ayus-bg)" />
        <rect width="48" height="48" rx="12" fill="url(#ayus-shine)" />

        {/* Leaf + heart silhouette — asymmetric leaf tilts to the right,
            bottom curves to a heart point so it reads as both a tulsi leaf
            and a wellbeing/heart mark. */}
        <path
          d="M24 39 C17 32 10 26 10 18 C10 13 13 9 18 9 C22 9 24 12 24 12 C24 12 28 6 34 8 C40 10 41 16 39 22 C37 28 30 33 24 39 Z"
          fill="white"
          fillOpacity="0.18"
          stroke="white"
          strokeWidth="1.6"
          strokeLinejoin="round"
        />

        {/* Pulse/ECG — sits across the leaf's midrib, subtle clinical signal */}
        <polyline
          points="11,23 16,23 18,19 21,28 24,16 27,26 30,22 33,23 38,23"
          fill="none"
          stroke="white"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>

      {showText && (
        <span
          className={cn(
            s.text,
            "font-bold tracking-tight bg-linear-to-r from-emerald-600 to-teal-500 bg-clip-text text-transparent"
          )}
        >
          Ayus
        </span>
      )}
    </div>
  );
}
