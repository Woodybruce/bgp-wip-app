// Wireframe-style image placeholder — swap for real photography.
export default function Placeholder({ label = "Image TBC", className = "" }: { label?: string; className?: string }) {
  return (
    <div className={`relative overflow-hidden bg-bgp-mist ${className}`}>
      <svg className="absolute inset-0 h-full w-full text-bgp-stone/50" preserveAspectRatio="none" viewBox="0 0 100 100">
        <line x1="0" y1="0" x2="100" y2="100" stroke="currentColor" strokeWidth="0.4" />
        <line x1="100" y1="0" x2="0" y2="100" stroke="currentColor" strokeWidth="0.4" />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center label-caps text-bgp-stone">{label}</span>
    </div>
  );
}
