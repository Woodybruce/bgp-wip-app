import { useState } from "react";
import { Link, useLocation } from "wouter";
import { NAV_ITEMS } from "../lib/content";

export default function Nav() {
  const [location] = useLocation();
  const [open, setOpen] = useState(false);
  const onHome = location === "/";

  return (
    <header className="bg-bgp-cream">
      <div className="mx-auto max-w-6xl px-4 pt-6 flex flex-col items-center">
        {/* On the home page the hero carries the giant wordmark */}
        {!onHome && (
          <Link href="/" aria-label="Bruce Gillingham Pollard home">
            <img src="/brand/bgp-logo-wine.svg" alt="bgp" className="h-11 md:h-14 w-auto" />
          </Link>
        )}
        <button
          className="md:hidden mt-4 mb-2 label-caps text-bgp-wine"
          onClick={() => setOpen(!open)}
          aria-expanded={open}
        >
          Menu
        </button>
        <nav
          className={`${open ? "flex" : "hidden"} md:flex flex-col md:flex-row items-center gap-2 md:gap-0 py-4`}
        >
          {NAV_ITEMS.map((item, i) => {
            const active = location.startsWith(item.href);
            return (
              <span key={item.href} className="flex items-center">
                {i > 0 && <span className="hidden md:inline mx-3 text-bgp-wine/40">/</span>}
                <Link
                  href={item.href}
                  onClick={() => setOpen(false)}
                  className={`label-caps whitespace-nowrap transition-colors ${
                    active ? "text-bgp-red" : "text-bgp-wine hover:text-bgp-red"
                  }`}
                >
                  {item.label}
                </Link>
              </span>
            );
          })}
        </nav>
      </div>

      {/* TALK TO US — fixed edge tab */}
      <a
        href="#contact"
        className="fixed right-0 top-1/2 z-40 -translate-y-1/2 bg-bgp-red text-white label-caps px-2.5 py-4 [writing-mode:vertical-rl] hover:bg-bgp-wine transition-colors"
      >
        Talk to us
      </a>
    </header>
  );
}
