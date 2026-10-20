import { useState } from "react";
import { Link } from "wouter";
import { CONTACT } from "../lib/content";
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
    <footer id="contact" className="redesign-footer">
      <div className="site-container redesign-footer__main">
        <div className="redesign-footer__invitation">
          <p className="redesign-footer__eyebrow">Contact</p>
          <h2>Talk to us.</h2>
          <a href={`tel:${CONTACT.phone.replace(/[^+\d]/g, "")}`} className="redesign-footer__phone">{CONTACT.phone}</a>
        </div>

        <div className="redesign-footer__details">
          <address>
            {CONTACT.addressLines.map((line) => <p key={line}>{line}</p>)}
            <a href={`mailto:${CONTACT.email}`} className="redesign-footer__email">{CONTACT.email}</a>
          </address>
        </div>

        <div className="redesign-footer__newsletter">
          <h2 className="redesign-footer__eyebrow">Newsletter</h2>
          <p id="newsletter-description">Keep up to date with BGP.</p>
          <form onSubmit={onSubmit}>
            <div className="redesign-footer__signup">
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
              />
              <button type="submit" disabled={status === "sending"}>
                {status === "sending" ? "Signing up…" : "Sign up"}
              </button>
            </div>
            <p id="newsletter-status" role="status" aria-live="polite" className={status === "done" || status === "error" ? "redesign-footer__status" : "sr-only"}>
              {status === "done" ? "Thanks — you're signed up." : status === "error" ? "Something went wrong — please try again." : status === "sending" ? "Signing up…" : ""}
            </p>
          </form>
        </div>
      </div>

      <div className="redesign-footer__base">
        <div className="site-container redesign-footer__base-inner">
          <Link href="/" aria-label="BGP home" className="redesign-footer__logo">
            <img src="/brand/bgp-block-nectar.svg" alt="" width="77" height="50" />
          </Link>
          <div className="redesign-footer__legal">
            <div className="redesign-footer__legal-links">
              <a href="https://www.brucegillinghampollard.com/privacy/" target="_blank" rel="noreferrer">Privacy policy</a>
              <a href="https://www.brucegillinghampollard.com/terms-and-conditions/" target="_blank" rel="noreferrer">Terms and conditions</a>
            </div>
            <p>© BGP 2013–{new Date().getFullYear()}. All registered trademarks.</p>
          </div>
          <div className="redesign-footer__social">
            <a href="https://www.linkedin.com/company/bruce-gillingham-pollard" target="_blank" rel="noreferrer" aria-label="BGP on LinkedIn">LinkedIn</a>
            <a href="https://www.instagram.com/brucegillinghampollard/" target="_blank" rel="noreferrer" aria-label="BGP on Instagram">Instagram</a>
          </div>
        </div>
      </div>
    </footer>
  );
}
