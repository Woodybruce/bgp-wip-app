import { useState } from "react";
import { Link, useLocation } from "wouter";
import { NAV_ITEMS } from "../lib/content";

export default function Nav() {
  const [location] = useLocation();
  const [open, setOpen] = useState(false);

  return (
    <header className="border-b border-bgp-line bg-bgp-paper">
      <div className="mx-auto max-w-6xl px-4 pt-8 pb-0 flex flex-col items-center">
        <Link href="/" aria-label="Bruce Gillingham Pollard home">
          <img src="/brand/bgp-logo-burgundy.svg" alt="bgp" className="h-12 md:h-14 w-auto" />
        </Link>
        <button
          className="md:hidden mt-4 mb-4 label-caps"
          onClick={() => setOpen(!open)}
          aria-expanded={open}
        >
          Menu
        </button>
        <nav
          className={`${open ? "flex" : "hidden"} md:flex flex-col md:flex-row items-center gap-2 md:gap-0 py-4 md:py-5`}
        >
          {NAV_ITEMS.map((item, i) => {
            const active = location.startsWith(item.href);
            return (
              <span key={item.href} className="flex items-center">
                {i > 0 && <span className="hidden md:inline mx-3 text-bgp-stone">/</span>}
                <Link
                  href={item.href}
                  onClick={() => setOpen(false)}
                  className={`label-caps whitespace-nowrap transition-colors ${
                    active ? "text-bgp-burgundy" : "text-bgp-ink hover:text-bgp-burgundy"
                  }`}
                >
                  {item.label}
                </Link>
              </span>
            );
          })}
        </nav>
      </div>

      {/* TALK TO US — fixed edge button per wireframe */}
      <a
        href="#contact"
        className="fixed right-0 top-1/2 z-40 -translate-y-1/2 bg-bgp-ink text-bgp-paper label-caps px-2.5 py-4 [writing-mode:vertical-rl] hover:bg-bgp-burgundy transition-colors"
      >
        Talk to us
      </a>
    </header>
  );
}
