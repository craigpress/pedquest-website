import type { CSSProperties } from "react";

/** Placeholder rows shown while a list loads, sized like the rows they stand in for. */
export default function SkeletonList({
  count = 3,
  height,
  className,
  style,
}: {
  count?: number;
  height: number;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <div className={className} style={style} role="status" aria-label="Loading">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="skeleton" style={{ height, borderRadius: 12 }} aria-hidden="true" />
      ))}
    </div>
  );
}
