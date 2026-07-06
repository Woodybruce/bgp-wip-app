import { CONTACT } from "../lib/content";

export default function Footer() {
  return (
    <footer id="contact" className="mt-24 bg-bgp-mist border-t border-bgp-line">
      <div className="mx-auto max-w-6xl px-4 py-12 grid grid-cols-1 md:grid-cols-3 gap-10">
        <div className="flex flex-col justify-between gap-8">
          <img src="/brand/bgp-logo-burgundy.svg" alt="bgp" className="h-10 w-auto self-start" />
          <div className="text-xs text-bgp-ink/60 space-y-1">
            <p><a href="#" className="hover:text-bgp-burgundy">Privacy Policy</a></p>
            <p><a href="#" className="hover:text-bgp-burgundy">Terms &amp; Conditions</a></p>
            <p>© {new Date().getFullYear()} Bruce Gillingham Pollard</p>
          </div>
        </div>

        <div>
          <p className="label-caps mb-4">Contact</p>
          <div className="text-sm leading-relaxed text-bgp-ink/80">
            <p>Bruce Gillingham Pollard</p>
            {CONTACT.addressLines.map((l) => (
              <p key={l}>{l}</p>
            ))}
            <p className="mt-3 tabular">{CONTACT.phone}</p>
            <p>
              <a href={`mailto:${CONTACT.email}`} className="underline decoration-bgp-stone underline-offset-2 hover:text-bgp-burgundy">
                {CONTACT.email}
              </a>
            </p>
          </div>
        </div>

        <div>
          <p className="label-caps mb-4">Newsletter</p>
          <p className="text-sm text-bgp-ink/70 mb-3">Keep up to date</p>
          <form
            onSubmit={(e) => e.preventDefault()}
            className="flex border-b border-bgp-ink max-w-xs"
          >
            <input
              type="email"
              placeholder="Email address"
              className="flex-1 bg-transparent py-2 text-sm outline-none placeholder:text-bgp-ink/40"
            />
            <button type="submit" className="label-caps py-2 hover:text-bgp-burgundy">
              Sign up →
            </button>
          </form>
          <div className="mt-6 flex gap-4 text-bgp-ink/70">
            <a href="#" aria-label="LinkedIn" className="hover:text-bgp-burgundy">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M20.45 20.45h-3.55v-5.57c0-1.33-.03-3.04-1.85-3.04-1.86 0-2.14 1.45-2.14 2.94v5.67H9.35V9h3.41v1.56h.05c.47-.9 1.63-1.85 3.36-1.85 3.6 0 4.27 2.37 4.27 5.46v6.28zM5.34 7.43a2.06 2.06 0 1 1 0-4.12 2.06 2.06 0 0 1 0 4.12zM7.12 20.45H3.56V9h3.56v11.45z"/></svg>
            </a>
            <a href="#" aria-label="Instagram" className="hover:text-bgp-burgundy">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.2" cy="6.8" r="0.8" fill="currentColor" stroke="none"/></svg>
            </a>
          </div>
        </div>
      </div>
    </footer>
  );
}
