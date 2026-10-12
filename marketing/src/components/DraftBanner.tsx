import { useDraftMode } from "../lib/draft";

// Sticky strip at the top of every page while draft mode is on, so nobody
// mistakes unapproved copy for the live site.
export default function DraftBanner() {
  const on = useDraftMode();
  if (!on) return null;
  return (
    <div className="bg-bgp-red text-white text-center label-caps py-2 px-4">
      Draft mode — showing copy that is not yet approved.{" "}
      <a href="?draft=0" className="underline">Exit</a>
    </div>
  );
}
