import { Link } from "wouter";
import { CONTACT, HERO_STATEMENT, NAV_ITEMS } from "../lib/content";

export default function Footer() {
  return (
    <footer id="contact" className="mt-24 bg-bgp-wine text-bgp-cream">
      <div className="mx-auto max-w-6xl px-4 pt-16 pb-10 grid grid-cols-1 md:grid-cols-4 gap-10">
        <div>
          <img src="/brand/bgp-logo-white.svg" alt="bgp" className="h-14 w-auto" />
          <p className="mt-5 font-display italic text-bgp-cream/80 text-lg leading-snug max-w-[16ch]">
            {HERO_STATEMENT}
          </p>
        </div>

        <div className="text-sm font-light leading-relaxed">
          <p className="label-caps mb-4 text-bgp-nectar">Explore</p>
          <ul className="space-y-2.5">
            {NAV_ITEMS.map((item) => (
              <li key={item.href}>
                <Link href={item.href} className="text-bgp-cream/85 hover:text-white transition-colors">
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </div>

        <div className="text-sm font-light leading-relaxed">
          <p className="label-caps mb-4 text-bgp-nectar">Contact</p>
          {CONTACT.addressLines.map((l) => (
            <p key={l} className="text-bgp-cream/85">{l}</p>
          ))}
          <p className="mt-4">
            <a href={`mailto:${CONTACT.email}`} className="text-bgp-cream/85 hover:text-white transition-colors break-all">
              {CONTACT.email}
            </a>
          </p>
          <p className="tabular text-bgp-cream/85">{CONTACT.phone}</p>
        </div>

        <div>
          <p className="label-caps mb-4 text-bgp-nectar">Newsletter</p>
          <p className="text-sm font-light text-bgp-cream/85 mb-4">
            Lettings, transactions and opinion from the BGP team.
          </p>
          <form onSubmit={(e) => e.preventDefault()} className="max-w-xs">
            <input
              type="email"
              placeholder="Email address"
              className="w-full bg-transparent border-b border-bgp-nectar/70 pb-2 text-sm outline-none placeholder:text-bgp-cream/50 text-white focus:border-bgp-nectar transition-colors"
            />
            <button type="submit" className="label-caps mt-4 text-white hover:text-bgp-nectar transition-colors">
              Sign up <span aria-hidden>⟶</span>
            </button>
          </form>
        </div>
      </div>

      <div className="border-t border-bgp-cream/15">
        <div className="mx-auto max-w-6xl px-4 py-8 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-6 text-xs text-bgp-cream/60">
          <div>
            <p>© Bruce Gillingham Pollard 2013–{String(new Date().getFullYear()).slice(2)}. All registered trademarks.</p>
          </div>
          <div className="flex gap-6">
            <a href="#" className="hover:text-white transition-colors">Privacy policy</a>
            <a href="#" className="hover:text-white transition-colors">Terms and conditions</a>
          </div>
          <div className="flex gap-4 text-bgp-cream/80">
            <a href="#" aria-label="LinkedIn" className="hover:text-white transition-colors">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M20.45 20.45h-3.55v-5.57c0-1.33-.03-3.04-1.85-3.04-1.86 0-2.14 1.45-2.14 2.94v5.67H9.35V9h3.41v1.56h.05c.47-.9 1.63-1.85 3.36-1.85 3.6 0 4.27 2.37 4.27 5.46v6.28zM5.34 7.43a2.06 2.06 0 1 1 0-4.12 2.06 2.06 0 0 1 0 4.12zM7.12 20.45H3.56V9h3.56v11.45z"/></svg>
            </a>
            <a href="#" aria-label="Instagram" className="hover:text-white transition-colors">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.2" cy="6.8" r="0.8" fill="currentColor" stroke="none"/></svg>
            </a>
          </div>
        </div>
      </div>
    </footer>
  );
}
