import { useEffect, useRef, useState } from "react";
import { Link, useLocation } from "wouter";
import { LEASING_SECTORS, NAV_ITEMS } from "../lib/content";

// Keep the four established leasing teams and the availability link.
const LEASING_LINKS = [
  ...LEASING_SECTORS.map((sector) => ({ label: sector.name, href: `/leasing/sectors/${sector.slug}` })),
  { label: "Available properties", href: "/leasing#availability" },
];

function Chevron({ expanded }: { expanded: boolean }) {
  return (
    <svg aria-hidden="true" width="12" height="12" viewBox="0 0 12 12" fill="none" className={`transition-transform ${expanded ? "rotate-180" : ""}`}>
      <path d="m2.5 4.25 3.5 3.5 3.5-3.5" stroke="currentColor" strokeWidth="1.25" />
    </svg>
  );
}

export default function Nav() {
  const [location] = useLocation();
  const [open, setOpen] = useState(false);
  const [leasingOpen, setLeasingOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const [hasHero, setHasHero] = useState(false);
  const headerRef = useRef<HTMLElement>(null);
  const mobileToggleRef = useRef<HTMLButtonElement>(null);
  const leasingToggleRef = useRef<HTMLButtonElement>(null);
  const leasingMenuRef = useRef<HTMLUListElement>(null);

  const closeMenus = () => {
    setOpen(false);
    setLeasingOpen(false);
  };

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 40);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    closeMenus();
    setHasHero(Boolean(document.querySelector("[data-hero]")));
  }, [location]);

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (!headerRef.current?.contains(event.target as Node)) closeMenus();
    };
    const onEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || (!open && !leasingOpen)) return;
      event.preventDefault();
      if (open) mobileToggleRef.current?.focus();
      else leasingToggleRef.current?.focus();
      closeMenus();
    };
    const breakpoint = window.matchMedia("(min-width: 1024px)");
    const onBreakpoint = () => closeMenus();
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onEscape);
    breakpoint.addEventListener("change", onBreakpoint);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onEscape);
      breakpoint.removeEventListener("change", onBreakpoint);
    };
  }, [open, leasingOpen]);

  const overHero = hasHero && !scrolled && !open;
  const logo = overHero ? "/brand/bgp-frame-white.svg" : "/brand/bgp-frame-bordeaux.svg";
  const foreground = overHero ? "text-white" : "text-bgp-wine";

  return (
    <>
      <header
        ref={headerRef}
        className={`sticky top-0 z-50 h-[var(--site-header-height)] border-b ${overHero ? "border-transparent bg-transparent text-white" : "border-bgp-wine/15 bg-bgp-cream text-bgp-wine"}`}
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) closeMenus();
        }}
      >
        <div className="site-container relative flex h-full items-center justify-between gap-8">
          <Link href="/" aria-label="Bruce Gillingham Pollard home" onClick={closeMenus} className="shrink-0">
            <img src={logo} alt="" width="99" height="64" className="h-[50px] w-auto lg:h-16" />
          </Link>

          <button
            ref={mobileToggleRef}
            type="button"
            className={`flex min-h-11 items-center gap-3 py-3 text-sm font-medium uppercase lg:hidden ${foreground}`}
            onClick={() => { setOpen(!open); setLeasingOpen(false); }}
            aria-expanded={open}
            aria-controls="mobile-navigation"
            aria-label={open ? "Close navigation" : "Open navigation"}
          >
            {open ? "Close" : "Menu"}
            <svg aria-hidden="true" width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.4" className={foreground}>
              {open ? <path d="m4 4 12 12M16 4 4 16" /> : <path d="M2 6h16M2 14h16" />}
            </svg>
          </button>

          <nav aria-label="Main navigation" className={`hidden lg:block ${foreground}`}>
            <ul className="flex items-center text-xs font-medium uppercase leading-none xl:text-[13px]">
              {NAV_ITEMS.map((item, index) => {
                const active = location === item.href || location.startsWith(`${item.href}/`);
                const isLeasing = item.href === "/leasing";
                return (
                  <li
                    key={item.href}
                    className="relative flex items-center"
                    onPointerEnter={isLeasing ? (event) => { if (event.pointerType === "mouse") setLeasingOpen(true); } : undefined}
                    onPointerLeave={isLeasing ? (event) => { if (!event.currentTarget.contains(document.activeElement)) setLeasingOpen(false); } : undefined}
                    onBlur={isLeasing ? (event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setLeasingOpen(false); } : undefined}
                  >
                    {index > 0 && <span aria-hidden="true" className="mx-2.5 opacity-50 xl:mx-3.5">/</span>}
                    <Link
                      href={item.href}
                      onClick={closeMenus}
                      aria-current={active ? "page" : undefined}
                      className={`whitespace-nowrap py-5 underline-offset-[6px] hover:underline ${active ? "underline" : ""}`}
                    >
                      {item.label}
                    </Link>
                    {isLeasing && (
                      <>
                        <button
                          ref={leasingToggleRef}
                          type="button"
                          aria-expanded={leasingOpen}
                          aria-controls="leasing-navigation"
                          aria-label={leasingOpen ? "Close Leasing menu" : "Open Leasing menu"}
                          className="ml-1 flex min-h-11 w-6 items-center justify-center"
                          onClick={() => setLeasingOpen(!leasingOpen)}
                          onKeyDown={(event) => {
                            if (event.key !== "ArrowDown") return;
                            event.preventDefault();
                            setLeasingOpen(true);
                            window.requestAnimationFrame(() => leasingMenuRef.current?.querySelector<HTMLAnchorElement>("a")?.focus());
                          }}
                        >
                          <Chevron expanded={leasingOpen} />
                        </button>
                        {leasingOpen && (
                          <ul
                            id="leasing-navigation"
                            ref={leasingMenuRef}
                            className="absolute left-0 top-full w-64 border border-bgp-wine/15 bg-bgp-cream px-6 py-4 text-sm font-medium normal-case leading-snug text-bgp-wine"
                          >
                            {LEASING_LINKS.map((link, linkIndex) => (
                              <li key={link.href} className={linkIndex === LEASING_LINKS.length - 1 ? "mt-2 border-t border-bgp-wine/20 pt-2" : ""}>
                                <a href={link.href} onClick={closeMenus} className="block py-2.5 underline-offset-4 hover:underline">{link.label}</a>
                              </li>
                            ))}
                          </ul>
                        )}
                      </>
                    )}
                  </li>
                );
              })}
            </ul>
          </nav>
        </div>

        {open && (
          <nav id="mobile-navigation" aria-label="Main navigation" className="absolute inset-x-0 top-full max-h-[calc(100dvh-var(--site-header-height))] overflow-y-auto border-b border-bgp-wine/20 bg-bgp-cream text-bgp-wine lg:hidden">
            <ul className="site-container pb-6">
              {NAV_ITEMS.map((item) => {
                const active = location === item.href || location.startsWith(`${item.href}/`);
                const isLeasing = item.href === "/leasing";
                return (
                  <li key={item.href} className="border-t border-bgp-wine/15">
                    <div className="flex items-center justify-between">
                      <Link href={item.href} onClick={closeMenus} aria-current={active ? "page" : undefined} className={`flex-1 py-4 text-sm font-medium uppercase underline-offset-4 ${active ? "underline" : ""}`}>
                        {item.label}
                      </Link>
                      {isLeasing && (
                        <button type="button" className="flex h-12 w-12 items-center justify-center" aria-label={leasingOpen ? "Close Leasing menu" : "Open Leasing menu"} aria-expanded={leasingOpen} aria-controls="mobile-leasing-navigation" onClick={() => setLeasingOpen(!leasingOpen)}>
                          <Chevron expanded={leasingOpen} />
                        </button>
                      )}
                    </div>
                    {isLeasing && leasingOpen && (
                      <ul id="mobile-leasing-navigation" className="pb-3 pl-4 text-sm">
                        {LEASING_LINKS.map((link) => (
                          <li key={link.href}><a href={link.href} onClick={closeMenus} className="block py-3 underline-offset-4 hover:underline">{link.label}</a></li>
                        ))}
                      </ul>
                    )}
                  </li>
                );
              })}
              <li className="border-t border-bgp-wine/15"><a href="#contact" onClick={closeMenus} className="block py-4 text-sm font-medium uppercase">Talk to us</a></li>
            </ul>
          </nav>
        )}
      </header>

      <a href="#contact" className="fixed right-0 top-1/2 z-40 hidden -translate-y-1/2 bg-bgp-wine px-3 py-5 text-xs font-medium uppercase text-bgp-nectar transition-colors [writing-mode:vertical-rl] hover:bg-bgp-ink lg:block">
        Talk to us
      </a>
    </>
  );
}
