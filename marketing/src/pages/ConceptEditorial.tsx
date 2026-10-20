import { useRef, useState } from "react";
import { Link } from "wouter";
import NewsSocialBoard from "../components/NewsSocialBoard";
import { CONTACT, HERO_STATEMENT, HOME_INTRO, LEASING_SECTORS, SERVICES } from "../lib/content";
import { useSiteContent } from "../lib/site-content";
import "./concept-editorial.css";

const places = [
  { slug: "shopping-centres", image: "/images/case-studies/landsec/westgate/westgate-8.jpg", caption: "Westgate, Oxford" },
  { slug: "london-estates", image: "/images/hero/portman-chiltern-street.jpg", caption: "The Portman Estate" },
  { slug: "high-streets", image: "/images/st-christophers-place.jpg", caption: "St Christopher’s Place" },
  { slug: "city", image: "/images/hero/canary-wharf.jpg", caption: "Canary Wharf" },
];

export default function ConceptEditorial() {
  const { caseStudies, team } = useSiteContent();
  const [menuOpen, setMenuOpen] = useState(false);
  const [placeIndex, setPlaceIndex] = useState(1);
  const menuButton = useRef<HTMLButtonElement>(null);
  const selectedPlace = places[placeIndex];
  const coverStory = caseStudies.find(story => story.slug === "percival-neal-street");
  const leasing = SERVICES.find(service => service.slug === "leasing")!;
  const stories = ["the-royal-exchange", "masaj-islington-square"]
    .map(slug => caseStudies.find(story => story.slug === slug))
    .filter((story): story is NonNullable<typeof story> => !!story);
  const people = ["Charlotte Roberts", "Harry Elliott", "Peter Wood"]
    .map(name => team.find(person => person.name === name))
    .filter((person): person is NonNullable<typeof person> => !!person?.photo);

  return (
    <div className="concept-editorial">
      <a className="ce-skip" href="#ce-content">Skip to content</a>
      <header className="ce-header ce-wrap" onKeyDown={event => {
        if (event.key === "Escape" && menuOpen) {
          setMenuOpen(false);
          menuButton.current?.focus();
        }
      }}>
        <Link href="/concepts/editorial" className="ce-logo" aria-label="BGP Editorial home">
          <img src="/brand/bgp-block-bordeaux.svg" width="77" height="50" alt="BGP" />
        </Link>
        <nav className="ce-desktop-nav" aria-label="Main navigation">
          <a href="#ce-stories">Case studies</a>
          <a href="#ce-expertise">Expertise</a>
          <a href="#ce-journal">Journal</a>
          <a href="#ce-contact" className="ce-contact-link">Contact</a>
        </nav>
        <button className="ce-menu-toggle" type="button" ref={menuButton} aria-expanded={menuOpen} aria-controls="ce-mobile-menu" onClick={() => setMenuOpen(!menuOpen)}>
          {menuOpen ? "Close" : "Menu"} <span aria-hidden="true">{menuOpen ? "−" : "+"}</span>
        </button>
        {menuOpen && <nav id="ce-mobile-menu" className="ce-mobile-nav" aria-label="Mobile navigation">
          {[["Case studies", "#ce-stories"], ["Expertise", "#ce-expertise"], ["Leasing", "#ce-places"], ["Journal", "#ce-journal"], ["Contact", "#ce-contact"]].map(([label, href]) =>
            <a href={href} key={href} onClick={() => setMenuOpen(false)}>{label}</a>)}
          <Link href="/team">Team</Link>
        </nav>}
      </header>

      <div id="ce-content">
        <section className="ce-hero ce-wrap" aria-labelledby="ce-title">
          <div className="ce-hero-copy">
            <p className="ce-kicker">BGP</p>
            <h1 id="ce-title">{HOME_INTRO.lead.split(" ").slice(0, -1).join(" ")}{" "}<em>{HOME_INTRO.lead.split(" ").slice(-1)[0]}</em></h1>
            <p className="ce-hero-intro">{HERO_STATEMENT}</p>
            <a href="#ce-stories" className="ce-line-link">View case studies</a>
            <Link href="/leasing/sectors/london-estates" className="ce-hero-small">
              <img src="/images/hero/portman-chiltern-street.jpg" alt="Independent shops and cafés on Chiltern Street" width="1800" height="1200" />
              <span><span className="ce-kicker">London Estates</span><span className="ce-serif">The Portman Estate</span></span>
            </Link>
          </div>
          <Link href="/case-studies/percival-neal-street" className="ce-cover">
            <div className="ce-cover-image">
              <img src="/images/case-studies/percival-neal-street.jpg" alt="Percival’s tailoring displayed in its Neal Street shop window" width="1164" height="1600" loading="eager" />
              <span className="ce-cover-label">{coverStory?.service ?? "Brand Representation"}</span>
            </div>
            <span className="ce-cover-caption"><span>{coverStory?.title ?? "Percival, Neal Street, Seven Dials"}</span><span>London, UK</span></span>
          </Link>
        </section>

        <section className="ce-intro ce-wrap" aria-labelledby="ce-intro-heading">
          <p className="ce-kicker">BGP</p>
          <div className="ce-intro-grid">
            <h2 id="ce-intro-heading">About <em>BGP</em></h2>
            <div className="ce-intro-copy">{HOME_INTRO.body.map(paragraph => <p key={paragraph}>{paragraph}</p>)}</div>
          </div>
        </section>

        <section className="ce-stories ce-wrap" id="ce-stories" aria-labelledby="ce-stories-heading">
          <div className="ce-section-rule"><p className="ce-kicker">01 / BGP</p><h2 id="ce-stories-heading">Case <em>studies</em></h2><a href="#ce-expertise" className="ce-line-link">Expertise</a></div>
          <div className="ce-stories-grid">
            {stories.map((story, index) => <Link key={story.slug} href={`/case-studies/${story.slug}`} className={`ce-story ce-story-${index + 1}`}>
              <div className="ce-story-image"><img src={story.image} alt={story.title} loading="lazy" /></div>
              <div className="ce-story-caption"><p className="ce-kicker">{story.service}</p><h3>{story.title}</h3><p>{story.blurb}</p></div>
            </Link>)}
          </div>
        </section>

        <section className="ce-expertise" id="ce-expertise" aria-labelledby="ce-expertise-heading">
          <div className="ce-wrap ce-expertise-grid">
            <div className="ce-expertise-heading"><p className="ce-kicker">02 / Services</p><h2 id="ce-expertise-heading">{HOME_INTRO.servicesHeading}</h2><Link href="/team" className="ce-line-link">Team</Link></div>
            <div className="ce-services">{SERVICES.map((service, index) => <details key={service.slug} open={index === 0}>
              <summary><span className="ce-service-number">0{index + 1}</span><h3>{service.name}</h3><span className="ce-service-plus" aria-hidden="true">+</span></summary>
              <div className="ce-service-copy"><p>{service.intro}</p><Link href={`/${service.slug}`} className="ce-line-link">Explore {service.name.toLowerCase()}</Link></div>
            </details>)}</div>
          </div>
        </section>

        <section className="ce-places ce-wrap" id="ce-places" aria-labelledby="ce-places-heading">
          <div className="ce-places-visual"><img key={selectedPlace.image} src={selectedPlace.image} alt={selectedPlace.caption} loading="lazy" /><p><span className="ce-kicker">Leasing</span>{selectedPlace.caption}</p></div>
          <div className="ce-places-copy">
            <p className="ce-kicker">03 / {leasing.name}</p>
            <h2 id="ce-places-heading"><em>{leasing.name}</em></h2>
            <p className="ce-places-description">{leasing.intro}</p>
            <div className="ce-place-links">{places.map((place, index) => <Link key={place.slug} href={`/leasing/sectors/${place.slug}`} onMouseEnter={() => setPlaceIndex(index)} onFocus={() => setPlaceIndex(index)} className={placeIndex === index ? "is-active" : ""}><span className="ce-place-number">0{index + 1}</span><span>{LEASING_SECTORS.find(sector => sector.slug === place.slug)?.name}</span></Link>)}</div>
            <Link href="/leasing#availability" className="ce-line-link">See available properties</Link>
          </div>
        </section>

        <section className="ce-journal ce-wrap" id="ce-journal" aria-label="BGP journal and social posts"><NewsSocialBoard compact /></section>

        <section className="ce-people ce-wrap" aria-labelledby="ce-people-heading">
          <div className="ce-people-heading"><p className="ce-kicker">BGP</p><h2 id="ce-people-heading">The BGP <em>team</em></h2><Link href="/team" className="ce-line-link">View the team</Link></div>
          <div className="ce-portraits">{people.map(person => <Link key={person.name} href="/team" className="ce-person"><img src={person.photo} alt={person.name} loading="lazy" /><h3>{person.name}</h3><p>{person.title}</p></Link>)}</div>
        </section>
      </div>

      <footer className="ce-footer" id="ce-contact">
        <div className="ce-wrap">
          <div className="ce-footer-invitation"><p className="ce-kicker">Contact</p><a href={`mailto:${CONTACT.email}`}>Talk to <em>us</em></a></div>
          <div className="ce-footer-details"><address>{CONTACT.addressLines.map(line => <span key={line}>{line}</span>)}</address><div><a href={`tel:${CONTACT.phone.replace(/[^+\d]/g, "")}`}>{CONTACT.phone}</a><a href={`mailto:${CONTACT.email}`}>{CONTACT.email}</a></div><div><a href="https://www.instagram.com/brucegillinghampollard/" target="_blank" rel="noreferrer">Instagram</a><a href="https://www.linkedin.com/company/bruce-gillingham-pollard" target="_blank" rel="noreferrer">LinkedIn</a></div></div>
          <div className="ce-footer-base"><img src="/brand/bgp-block-nectar.svg" width="77" height="50" alt="BGP" /><p>© {new Date().getFullYear()} BGP</p><a href="https://www.brucegillinghampollard.com/privacy/" target="_blank" rel="noreferrer">Privacy policy</a></div>
        </div>
      </footer>
    </div>
  );
}
