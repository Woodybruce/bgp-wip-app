import { useState } from "react";
import { Link, useLocation } from "wouter";
import { NAV_ITEMS } from "../lib/content";

// Sticky compact header. On phones: slim bar (wordmark left, MENU toggle
// right) with a drop-down panel that overlays the page instead of pushing
// it down. On desktop: the centred inline nav, kept in view while scrolling.
export default function Nav() {
  const [location] = useLocation();
  const [open, setOpen] = useState(false);

  return (
    <header className="sticky top-0 z-50 bg-bgp-cream/95 backdrop-blur border-b border-bgp-wine/10">
      <div className="relative mx-auto max-w-6xl px-4">
        {/* Phone bar */}
        <div className="flex md:hidden items-center justify-between h-14">
          <Link href="/" aria-label="Bruce Gillingham Pollard home" onClick={() => setOpen(false)}>
            <img src="/brand/bgp-logo-wine.svg" alt="bgp" className="h-7 w-auto" />
          </Link>
          <button
            className="label-caps text-bgp-wine px-2 py-2 -mr-2"
            onClick={() => setOpen(!open)}
            aria-expanded={open}
            aria-label={open ? "Close menu" : "Open menu"}
          >
            {open ? "Close ✕" : "Menu"}
          </button>
        </div>

        {/* Phone drop-down — overlays content, so the page never jumps */}
        {open && (
          <nav className="md:hidden absolute inset-x-0 top-full bg-bgp-cream border-b border-bgp-wine/15 shadow-[0_16px_40px_-20px_rgba(110,12,37,0.35)]">
            {NAV_ITEMS.map((item) => {
              const active = location.startsWith(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setOpen(false)}
                  className={`block px-4 py-3.5 label-caps border-t border-bgp-wine/10 ${
                    active ? "text-bgp-red" : "text-bgp-wine"
                  }`}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>
        )}

        {/* Desktop bar */}
        <div className="hidden md:flex items-center justify-between h-16">
          <Link href="/" aria-label="Bruce Gillingham Pollard home" className="shrink-0">
            <img src="/brand/bgp-logo-wine.svg" alt="bgp" className="h-8 w-auto" />
          </Link>
          <nav className="flex items-center">
            {NAV_ITEMS.map((item, i) => {
              const active = location.startsWith(item.href);
              return (
                <span key={item.href} className="flex items-center">
                  {i > 0 && <span className="mx-3 text-bgp-wine/40">/</span>}
                  <Link
                    href={item.href}
                    data-active={active}
                    className={`label-caps nav-link whitespace-nowrap transition-colors ${
                      active ? "text-bgp-red" : "text-bgp-wine hover:text-bgp-red"
                    }`}
                  >
                    {item.label}
                  </Link>
                </span>
              );
            })}
          </nav>
          <span className="w-8 shrink-0" aria-hidden />
        </div>
      </div>

      {/* TALK TO US — fixed edge tab. Desktop only: on phones it overlapped
          the menu button and stole its taps (contact lives in the footer). */}
      <a
        href="#contact"
        className="hidden md:block fixed right-0 top-1/2 z-40 -translate-y-1/2 bg-bgp-red text-white label-caps px-2.5 py-4 [writing-mode:vertical-rl] hover:bg-bgp-wine transition-colors"
      >
        Talk to us
      </a>
    </header>
  );
}
