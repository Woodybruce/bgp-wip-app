import { useEffect, useRef, useState } from "react";
import { Link, useLocation } from "wouter";
import "./chrome-redesign.css";

type NavigationGroup = "places" | "expertise";
type NavigationLink = { label: string; href: string };

const GROUPS: { id: NavigationGroup; label: string; links: NavigationLink[] }[] = [
  {
    id: "places",
    label: "Places",
    links: [
      { label: "Shopping centres", href: "/leasing/sectors/shopping-centres" },
      { label: "London estates", href: "/leasing/sectors/london-estates" },
      { label: "High streets", href: "/leasing/sectors/high-streets" },
      { label: "The City", href: "/leasing/sectors/city" },
      { label: "Available properties", href: "/leasing#availability" },
    ],
  },
  {
    id: "expertise",
    label: "Expertise",
    links: [
      { label: "Leasing", href: "/leasing" },
      { label: "Investment", href: "/investment" },
      { label: "Brand representation", href: "/brand-representation" },
      { label: "Lease advisory", href: "/lease-advisory" },
      { label: "Consultancy", href: "/consultancy" },
    ],
  },
];

const LINKS: NavigationLink[] = [
  { label: "People", href: "/team" },
  { label: "News & social", href: "/news" },
];

function Chevron({ expanded }: { expanded: boolean }) {
  return (
    <svg aria-hidden="true" width="12" height="12" viewBox="0 0 12 12" fill="none" className={`redesign-nav__chevron${expanded ? " is-open" : ""}`}>
      <path d="m2.5 4.25 3.5 3.5 3.5-3.5" stroke="currentColor" strokeWidth="1.25" />
    </svg>
  );
}

export default function Nav() {
  const [location] = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [expanded, setExpanded] = useState<NavigationGroup | null>(null);
  const headerRef = useRef<HTMLElement>(null);
  const mobileToggleRef = useRef<HTMLButtonElement>(null);
  const desktopToggles = useRef<Partial<Record<NavigationGroup, HTMLButtonElement | null>>>({});
  const mobileToggles = useRef<Partial<Record<NavigationGroup, HTMLButtonElement | null>>>({});

  const closeMenus = () => {
    setMobileOpen(false);
    setExpanded(null);
  };

  const isActive = (href: string) => {
    const path = href.split("#")[0];
    return location === path || location.startsWith(`${path}/`);
  };

  useEffect(() => { closeMenus(); }, [location]);

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (!headerRef.current?.contains(event.target as Node)) closeMenus();
    };
    const onEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || (!mobileOpen && !expanded)) return;
      event.preventDefault();
      if (expanded) {
        const toggles = mobileOpen ? mobileToggles : desktopToggles;
        toggles.current[expanded]?.focus();
        setExpanded(null);
      } else {
        mobileToggleRef.current?.focus();
        setMobileOpen(false);
      }
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
  }, [mobileOpen, expanded]);

  const focusGroup = (group: NavigationGroup, mobile = false) => {
    setExpanded(group);
    window.requestAnimationFrame(() => {
      headerRef.current?.querySelector<HTMLAnchorElement>(`#${mobile ? "mobile" : "desktop"}-${group}-navigation a`)?.focus();
    });
  };

  const groupLinks = (links: NavigationLink[]) => (
    <ul>
      {links.map((link) => (
        <li key={link.href}>
          {link.href.includes("#") ? (
            <a href={link.href} onClick={closeMenus}>
              {link.label}<span aria-hidden="true">↗</span>
            </a>
          ) : (
            <Link href={link.href} onClick={closeMenus} aria-current={location === link.href ? "page" : undefined}>
              {link.label}<span aria-hidden="true">↗</span>
            </Link>
          )}
        </li>
      ))}
    </ul>
  );

  return (
    <header
      ref={headerRef}
      className="redesign-nav"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) closeMenus();
      }}
    >
      <div className="site-container redesign-nav__inner">
        <Link href="/" aria-label="Bruce Gillingham Pollard home" onClick={closeMenus} className="redesign-nav__logo">
          <img src="/brand/bgp-block-bordeaux.svg" alt="" width="77" height="50" />
        </Link>

        <nav aria-label="Main navigation" className="redesign-nav__desktop">
          <ul className="redesign-nav__items">
            {GROUPS.map((group) => (
              <li key={group.id} className="redesign-nav__group" onBlur={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setExpanded(null);
              }}>
                <button
                  ref={(node) => { desktopToggles.current[group.id] = node; }}
                  type="button"
                  aria-expanded={expanded === group.id}
                  aria-controls={`desktop-${group.id}-navigation`}
                  className={`redesign-nav__link${group.links.some((link) => isActive(link.href)) ? " is-active" : ""}`}
                  onClick={() => setExpanded((current) => current === group.id ? null : group.id)}
                  onKeyDown={(event) => {
                    if (event.key !== "ArrowDown") return;
                    event.preventDefault();
                    focusGroup(group.id);
                  }}
                >
                  {group.label}<Chevron expanded={expanded === group.id} />
                </button>
                {expanded === group.id && (
                  <div id={`desktop-${group.id}-navigation`} className="redesign-nav__dropdown">
                    {groupLinks(group.links)}
                  </div>
                )}
              </li>
            ))}
            {LINKS.map((link) => (
              <li key={link.href}>
                <Link href={link.href} onClick={closeMenus} aria-current={isActive(link.href) ? "page" : undefined} className="redesign-nav__link">{link.label}</Link>
              </li>
            ))}
            <li><a href="#contact" onClick={closeMenus} className="redesign-nav__contact">Talk to us<span aria-hidden="true">↗</span></a></li>
          </ul>
        </nav>

        <button
          ref={mobileToggleRef}
          type="button"
          className="redesign-nav__mobile-toggle"
          onClick={() => { setMobileOpen((current) => !current); setExpanded(null); }}
          aria-expanded={mobileOpen}
          aria-controls="mobile-navigation"
          aria-label={mobileOpen ? "Close navigation" : "Open navigation"}
        >
          {mobileOpen ? "Close" : "Menu"}
          <svg aria-hidden="true" width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.4">
            {mobileOpen ? <path d="m4 4 12 12M16 4 4 16" /> : <path d="M2 6h16M2 14h16" />}
          </svg>
        </button>
      </div>

      {mobileOpen && (
        <nav id="mobile-navigation" aria-label="Main navigation" className="redesign-nav__mobile">
          <ul className="site-container redesign-nav__mobile-items">
            {GROUPS.map((group) => (
              <li key={group.id}>
                <button
                  ref={(node) => { mobileToggles.current[group.id] = node; }}
                  type="button"
                  aria-expanded={expanded === group.id}
                  aria-controls={`mobile-${group.id}-navigation`}
                  className="redesign-nav__mobile-link"
                  onClick={() => setExpanded((current) => current === group.id ? null : group.id)}
                  onKeyDown={(event) => {
                    if (event.key !== "ArrowDown") return;
                    event.preventDefault();
                    focusGroup(group.id, true);
                  }}
                >
                  {group.label}<Chevron expanded={expanded === group.id} />
                </button>
                {expanded === group.id && <div id={`mobile-${group.id}-navigation`} className="redesign-nav__mobile-group">{groupLinks(group.links)}</div>}
              </li>
            ))}
            {LINKS.map((link) => (
              <li key={link.href}>
                <Link href={link.href} onClick={closeMenus} aria-current={isActive(link.href) ? "page" : undefined} className="redesign-nav__mobile-link">{link.label}<span aria-hidden="true">↗</span></Link>
              </li>
            ))}
            <li><a href="#contact" onClick={closeMenus} className="redesign-nav__mobile-link redesign-nav__mobile-contact">Talk to us<span aria-hidden="true">↗</span></a></li>
          </ul>
        </nav>
      )}
    </header>
  );
}
