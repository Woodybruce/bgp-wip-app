import { useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import { LEASING_SECTORS, NAV_ITEMS } from "../lib/content";

// Wireframe slide 22: a rollover menu under Leasing, split into Location,
// Estates and Type. Location and Type pre-set the availability filters.
// Leasing rollover: the four teams, then the availability list (Woody, 2026-10-16).
const LEASING_MENU: Array<{ heading: string; items: Array<{ label: string; href: string }> }> = [
  { heading: "Leasing", items: [...LEASING_SECTORS.map((s) => ({ label: s.name, href: `/leasing/sectors/${s.slug}` })), { label: "Available properties", href: "/leasing#availability" }] },
];

// Sticky compact header. On phones: slim bar (wordmark left, MENU toggle
// right) with a drop-down panel that overlays the page instead of pushing
// it down. On desktop: the centred inline nav, kept in view while scrolling.
export default function Nav() {
  const [location] = useLocation();
  const [open, setOpen] = useState(false);
  // The slides draw the bar inside the hero photo: transparent with white text
  // at the top of a hero page, cream once scrolled or on pages without a hero.
  const [scrolled, setScrolled] = useState(false);
  const [hasHero, setHasHero] = useState(false);
  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 40);
    on();
    window.addEventListener("scroll", on, { passive: true });
    return () => window.removeEventListener("scroll", on);
  }, []);
  useEffect(() => { setHasHero(!!document.querySelector("[data-hero]")); }, [location]);
  const over = hasHero && !scrolled && !open;

  return (
    <>
    <header className={`sticky top-0 z-50 border-b transition-colors ${over ? "bg-transparent border-transparent" : "bg-bgp-cream/95 backdrop-blur border-bgp-wine/10"}`}>
      <div className="relative mx-auto max-w-[1360px] px-4">
        {/* Phone bar */}
        <div className="flex md:hidden items-center justify-between h-16">
          <Link href="/" aria-label="Bruce Gillingham Pollard home" onClick={() => setOpen(false)}>
            <img src="/brand/bgp-frame-bordeaux.svg" alt="bgp" className="h-[50px] w-auto" />
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
                    active ? "text-bgp-wine" : "text-bgp-wine"
                  }`}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>
        )}

        {/* Desktop bar */}
        <div className="hidden md:flex items-center justify-between h-24 lg:h-28">
          <Link href="/" aria-label="Bruce Gillingham Pollard home" className="shrink-0">
            {/* Frame logo, never below the 50px minimum (guidelines p.3); the slide draws it larger */}
            <img src={over ? "/brand/bgp-frame-white.svg" : "/brand/bgp-frame-bordeaux.svg"} alt="bgp" className="h-[50px] lg:h-[68px] w-auto" />
          </Link>
          <nav className="flex items-center">
            {NAV_ITEMS.map((item, i) => {
              const active = location.startsWith(item.href);
              const menu = item.href === "/leasing";
              return (
                <span key={item.href} className={`flex items-center ${menu ? "group/menu relative" : ""}`}>
                  {i > 0 && <span className={`mx-3 ${over ? "text-white/50" : "text-bgp-wine/40"}`}>/</span>}
                  <Link
                    href={item.href}
                    data-active={active}
                    className={`label-caps md:text-[0.8rem] nav-link whitespace-nowrap transition-colors py-7 ${
                      over ? "text-white hover:opacity-80" : active ? "text-bgp-wine" : "text-bgp-wine hover:opacity-70"
                    }`}
                  >
                    {item.label}
                  </Link>
                  {menu && (
                    <div className="absolute left-0 top-full z-50 hidden group-hover/menu:grid group-focus-within/menu:grid grid-cols-1 gap-y-1 bg-bgp-mist px-6 py-5 w-max min-w-[14rem] shadow-[0_16px_40px_-20px_rgba(110,12,37,0.35)]">
                      {LEASING_MENU.map((col) => (
                        <div key={col.heading}>
                          <ul className="space-y-2">
                            {col.items.map((it) => (
                              <li key={it.label}>
                                <a href={it.href} className={`text-sm text-bgp-ink hover:text-bgp-wine ${it.label === "Available properties" ? "border-t border-bgp-ink/30 pt-2 mt-1 block" : ""}`}>{it.label}</a>
                              </li>
                            ))}
                          </ul>
                        </div>
                      ))}
                    </div>
                  )}
                </span>
              );
            })}
          </nav>
          <span className="w-8 shrink-0" aria-hidden />
        </div>
      </div>

    </header>

    {/* TALK TO US — fixed edge tab. Desktop only (on phones it overlapped
        the menu button). Lives OUTSIDE the header: backdrop-blur on the
        sticky bar turns it into the containing block for fixed children,
        which pinned this tab inside the header and mangled it. */}
    <a
      href="#contact"
      className="hidden md:block fixed right-0 top-1/2 z-40 -translate-y-1/2 bg-bgp-wine text-bgp-nectar label-caps px-2.5 py-4 [writing-mode:vertical-rl] hover:bg-bgp-ink transition-colors"
    >
      Talk to us
    </a>
    </>
  );
}
