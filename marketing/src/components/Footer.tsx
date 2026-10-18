import { useState } from "react";
import { Link } from "wouter";
import { CONTACT, HERO_STATEMENT, NAV_ITEMS } from "../lib/content";
import { newsletterSignup } from "../lib/api";

export default function Footer() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "done" | "error">("idle");

  const onSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!email.trim() || status === "sending") return;
    setStatus("sending");
    try {
      await newsletterSignup(email.trim());
      setStatus("done");
      setEmail("");
    } catch {
      setStatus("error");
    }
  };

  return (
    <footer id="contact" className="bg-bgp-wine text-bgp-cream">
      <div className="site-container grid gap-x-10 gap-y-12 py-14 sm:grid-cols-2 lg:grid-cols-12 lg:gap-x-12 lg:py-20">
        <div className="sm:col-span-2 lg:col-span-6">
          <Link href="/" aria-label="Bruce Gillingham Pollard home" className="inline-block">
            <img src="/brand/bgp-frame-nectar.svg" alt="" width="123" height="80" className="h-16 w-auto lg:h-20" />
          </Link>
          <p className="mt-7 max-w-[32ch] text-xl font-light leading-snug text-bgp-cream lg:text-2xl">{HERO_STATEMENT}</p>
          <div className="mt-8 flex flex-wrap gap-x-6 gap-y-3 text-xs text-bgp-cream/85">
            <a href="https://www.brucegillinghampollard.com/privacy/" target="_blank" rel="noreferrer" className="underline-offset-4 hover:underline">Privacy policy</a>
            <a href="https://www.brucegillinghampollard.com/terms-and-conditions/" target="_blank" rel="noreferrer" className="underline-offset-4 hover:underline">Terms and conditions</a>
          </div>
          <p className="mt-4 max-w-sm text-xs leading-relaxed text-bgp-cream/80">© Bruce Gillingham Pollard 2013–{new Date().getFullYear()}. All registered trademarks.</p>
        </div>

        <div className="min-w-0 lg:col-span-3">
          <h2 className="mb-5 text-sm font-medium uppercase text-bgp-nectar">Contact</h2>
          <address className="text-sm not-italic leading-relaxed">
            {CONTACT.addressLines.map((line) => <p key={line}>{line}</p>)}
            <p className="mt-5"><a href={`tel:${CONTACT.phone.replace(/[^+\d]/g, "")}`} className="tabular underline-offset-4 hover:underline">{CONTACT.phone}</a></p>
            <p className="mt-1"><a href={`mailto:${CONTACT.email}`} className="break-words underline-offset-4 hover:underline">{CONTACT.email}</a></p>
          </address>
        </div>

        <div className="min-w-0 lg:col-span-3">
          <h2 className="mb-5 text-sm font-medium uppercase text-bgp-nectar">Newsletter</h2>
          <p id="newsletter-description" className="mb-5 max-w-xs text-sm leading-relaxed">Lettings, transactions and opinion from the BGP team.</p>
          <form onSubmit={onSubmit} className="max-w-sm">
            <label htmlFor="newsletter-email" className="sr-only">Email address</label>
            <input
              id="newsletter-email"
              name="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(event) => { setEmail(event.target.value); if (status === "done" || status === "error") setStatus("idle"); }}
              aria-describedby="newsletter-description newsletter-status"
              placeholder="Email address"
              className="w-full rounded-none border-0 border-b border-bgp-nectar bg-transparent px-0 py-3 text-base text-bgp-cream placeholder:text-bgp-cream/75 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-bgp-nectar"
            />
            <button type="submit" disabled={status === "sending"} className="mt-3 flex min-h-11 items-center gap-3 text-sm font-medium text-bgp-cream underline-offset-4 hover:underline disabled:opacity-60">
              {status === "sending" ? "Signing up…" : <>Sign up <span aria-hidden="true">⟶</span></>}
            </button>
            <p id="newsletter-status" role="status" aria-live="polite" className={status === "done" || status === "error" ? "mt-2 text-sm leading-relaxed text-bgp-nectar" : "sr-only"}>
              {status === "done" ? "Thanks — you're signed up." : status === "error" ? "Something went wrong — please try again." : status === "sending" ? "Signing up…" : ""}
            </p>
          </form>
          <div className="mt-6 flex items-center gap-6 text-bgp-nectar">
            <a href="https://www.linkedin.com/company/bruce-gillingham-pollard" target="_blank" rel="noreferrer" aria-label="BGP on LinkedIn" className="flex min-h-11 min-w-11 items-center hover:text-bgp-cream">
              <svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><path d="M20.45 20.45h-3.55v-5.57c0-1.33-.03-3.04-1.85-3.04-1.86 0-2.14 1.45-2.14 2.94v5.67H9.35V9h3.41v1.56h.05c.47-.9 1.63-1.85 3.36-1.85 3.6 0 4.27 2.37 4.27 5.46v6.28zM5.34 7.43a2.06 2.06 0 1 1 0-4.12 2.06 2.06 0 0 1 0 4.12zM7.12 20.45H3.56V9h3.56v11.45z" /></svg>
            </a>
            <a href="https://www.instagram.com/brucegillinghampollard/" target="_blank" rel="noreferrer" aria-label="BGP on Instagram" className="flex min-h-11 min-w-11 items-center hover:text-bgp-cream">
              <svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><rect x="3" y="3" width="18" height="18" rx="5" /><circle cx="12" cy="12" r="4" /><circle cx="17.2" cy="6.8" r="0.8" fill="currentColor" stroke="none" /></svg>
            </a>
          </div>
        </div>
      </div>

      <div className="border-t border-bgp-cream/20">
        <nav aria-label="Explore BGP" className="site-container py-6">
          <ul className="flex flex-wrap gap-x-7 gap-y-1 text-xs font-medium uppercase">
            {NAV_ITEMS.map((item) => <li key={item.href}><Link href={item.href} className="inline-block py-3 text-bgp-cream underline-offset-4 hover:underline">{item.label}</Link></li>)}
          </ul>
        </nav>
      </div>
    </footer>
  );
}
