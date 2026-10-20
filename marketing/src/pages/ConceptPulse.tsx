import { useRef, useState } from "react";
import { Link } from "wouter";
import { CONTACT, HERO_STATEMENT, HOME_INTRO, LEASING_SECTORS, SERVICES } from "../lib/content";
import { useSiteContent } from "../lib/site-content";
import NewsSocialBoard from "../components/NewsSocialBoard";
import "./concept-pulse.css";

const spotlights = [
  { image: "/images/hero/portman-chiltern-street.jpg", alt: "Independent shops and cafés on Chiltern Street, Marylebone", place: "The Portman Estate", kind: "London Estates", href: "/leasing/sectors/london-estates" },
  { image: "/images/case-studies/atis-loxton-walk.jpg", alt: "People gathering outside atis on Loxton Walk", place: "atis, Loxton Walk", kind: "Brand Representation", href: "/case-studies/atis-loxton-walk" },
  { image: "/images/case-studies/landsec/westgate/westgate-8.jpg", alt: "The rooftop restaurant terrace at Westgate Oxford", place: "Westgate, Oxford", kind: "Shopping Centres", href: "/case-studies/westgate-oxford" },
];
const places = [
  { slug: "shopping-centres", image: "/images/case-studies/landsec/trinity/trinity-2.jpg", alt: "The glass roof and retail galleries at Trinity Leeds" },
  { slug: "london-estates", image: "/images/gallery/chiltern-street.jpg", alt: "Red brick shopfronts on Chiltern Street" },
  { slug: "high-streets", image: "/images/st-christophers-place.jpg", alt: "Shops and cafés at St Christopher’s Place" },
  { slug: "city", image: "/images/hero/canary-wharf.jpg", alt: "Retail and restaurants beside the water at Canary Wharf" },
];

function Arrow({ diagonal = true }: { diagonal?: boolean }) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d={diagonal ? "M5 19 19 5M5 5h14v14" : "M4 12h16m-7-7 7 7-7 7"} /></svg>;
}

export default function ConceptPulse() {
  const { caseStudies, team } = useSiteContent();
  const [active, setActive] = useState(0);
  const [serviceIndex, setServiceIndex] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);
  const spotlight = spotlights[active];
  const displayedServiceIndex = Math.max(0, serviceIndex);
  const service = SERVICES[displayedServiceIndex];
  const projects = ["percival-neal-street", "westgate-oxford", "the-royal-exchange"]
    .map(slug => caseStudies.find(project => project.slug === slug))
    .filter((project): project is NonNullable<typeof project> => !!project?.image);
  const people = ["Charlotte Roberts", "Harry Elliott", "Peter Wood", "Tracey Pollard"]
    .map(name => team.find(person => person.name === name))
    .filter((person): person is NonNullable<typeof person> => !!person?.photo);

  return (
    <div className="concept-pulse">
      <header className="cp-header" onKeyDown={event => {
        if (event.key === "Escape" && menuOpen) { setMenuOpen(false); menuButton.current?.focus(); }
      }}>
        <Link href="/concepts/pulse" className="cp-logo" aria-label="Bruce Gillingham Pollard home"><img src="/brand/bgp-block-nectar.svg" alt="" width="77" height="50" /></Link>
        <p className="cp-header-signature">Bruce Gillingham<br />Pollard</p>
        <button type="button" ref={menuButton} className="cp-menu-button" aria-expanded={menuOpen} aria-controls="cp-navigation" onClick={() => setMenuOpen(!menuOpen)}>{menuOpen ? "Close" : "Menu"}<span aria-hidden="true">{menuOpen ? "−" : "+"}</span></button>
        <nav id="cp-navigation" className={`cp-nav${menuOpen ? " is-open" : ""}`} aria-label="Main navigation">
          <a href="#cp-work" onClick={() => setMenuOpen(false)}>Our world</a>
          <a href="#cp-expertise" onClick={() => setMenuOpen(false)}>Expertise</a>
          <Link href="/team">People</Link>
          <a href="#cp-journal" onClick={() => setMenuOpen(false)}>News & social</a>
          <a href="#cp-contact" className="cp-nav-contact" onClick={() => setMenuOpen(false)}>Let’s talk <Arrow /></a>
        </nav>
      </header>

      <section className="cp-hero" aria-labelledby="cp-title">
        <img key={spotlight.image} className="cp-hero-image" src={spotlight.image} alt={spotlight.alt} loading="eager" />
        <div className="cp-hero-scrim" />
        <div className="cp-hero-top"><p>Retail. Leisure. Hospitality.</p><span>Independent by nature.</span></div>
        <div className="cp-hero-heading"><h1 id="cp-title">Good places.<br />Great energy<span>.</span></h1><p>Connecting ambitious brands<br />with places that matter.</p></div>
        <div className="cp-hero-bottom">
          <Link href={spotlight.href} className="cp-spotlight" aria-live="polite"><span><small>{spotlight.kind}</small>{spotlight.place}</span><Arrow /></Link>
          <div className="cp-hero-switch" aria-label="Choose a featured place">{spotlights.map((item, index) => <button key={item.place} type="button" aria-label={`Show ${item.place}`} aria-pressed={active === index} onClick={() => setActive(index)}><span>0{index + 1}</span><i /></button>)}</div>
        </div>
      </section>

      <div className="cp-ticker" aria-hidden="true"><span>Places.</span><b>↗</b><span>People.</span><b>↗</b><span>Possibility.</span><b>↗</b><span>BGP.</span></div>

      <section className="cp-about cp-wrap" aria-labelledby="cp-about-title">
        <p className="cp-label"><span>01 /</span> A different perspective</p>
        <div><h2 id="cp-about-title">The right minds.<br />The right connections.<br /><span>The next possibility.</span></h2>
          <div className="cp-about-copy"><p>{HERO_STATEMENT}</p><details><summary>Get to know BGP <span aria-hidden="true">+</span></summary>{HOME_INTRO.body.map(paragraph => <p key={paragraph}>{paragraph}</p>)}</details></div>
        </div>
      </section>

      <section className="cp-work cp-wrap" id="cp-work" aria-labelledby="cp-work-title">
        <div className="cp-section-heading"><div><p className="cp-label"><span>02 /</span> Out in the world</p><h2 id="cp-work-title">Made for<br /><span>real life.</span></h2></div><p>Shops with a following.<br />Places with a pulse.<br />A few of the stories behind our work.</p></div>
        <div className="cp-projects">{projects.map((project, index) => <Link key={project.slug} href={`/case-studies/${project.slug}`} className={`cp-project cp-project-${index + 1}`}>
          <div className="cp-project-image"><img src={project.image} alt={project.title} loading="lazy" /><span className="cp-project-number" aria-hidden="true">0{index + 1}</span><span className="cp-project-arrow"><Arrow /></span></div>
          <div className="cp-project-caption"><p>{project.service}</p><h3>{project.title}</h3><p className="cp-project-blurb">{project.blurb}</p></div>
        </Link>)}</div>
      </section>

      <section className="cp-expertise" id="cp-expertise" aria-labelledby="cp-expertise-title">
        <div className="cp-wrap"><div className="cp-section-heading"><div><p className="cp-label"><span>03 /</span> What we bring</p><h2 id="cp-expertise-title">All the angles.<br /><span>One team.</span></h2></div><p>{HOME_INTRO.servicesHeading}</p></div>
          <div className="cp-expertise-layout">
            <div className="cp-service-image"><img key={service.image} src={service.image} alt={service.name} loading="lazy" /><span aria-hidden="true">0{displayedServiceIndex + 1}</span></div>
            <div className="cp-services">{SERVICES.map((item, index) => <div key={item.slug} className={`cp-service${serviceIndex === index ? " is-active" : ""}`}>
              <h3><button type="button" aria-expanded={serviceIndex === index} aria-controls={`cp-service-${item.slug}`} onClick={() => setServiceIndex(serviceIndex === index ? -1 : index)}><span className="cp-service-index">0{index + 1}</span><span>{item.name}</span><span className="cp-service-toggle" aria-hidden="true">{serviceIndex === index ? "−" : "+"}</span></button></h3>
              <div id={`cp-service-${item.slug}`} hidden={serviceIndex !== index}><p>{item.intro}</p><Link href={`/${item.slug}`} className="cp-inline-link">Explore {item.name.toLowerCase()} <Arrow /></Link></div>
            </div>)}</div>
          </div>
        </div>
      </section>

      <section className="cp-places cp-wrap" aria-labelledby="cp-places-title">
        <div className="cp-section-heading"><div><p className="cp-label"><span>04 /</span> Know the neighbourhood</p><h2 id="cp-places-title">Every place.<br /><span>Its own personality.</span></h2></div><Link href="/leasing#availability" className="cp-inline-link">Find your next space <Arrow /></Link></div>
        <div className="cp-places-grid">{places.map((place, index) => {
          const sector = LEASING_SECTORS.find(item => item.slug === place.slug);
          return <Link key={place.slug} href={`/leasing/sectors/${place.slug}`} className="cp-place"><div className="cp-place-image"><img src={place.image} alt={place.alt} loading="lazy" /><span aria-hidden="true">0{index + 1}</span></div><h3>{sector?.name}<Arrow /></h3></Link>;
        })}</div>
      </section>

      <section className="cp-people" aria-labelledby="cp-people-title"><div className="cp-wrap cp-people-layout"><div><p className="cp-label"><span>05 /</span> Good company</p><h2 id="cp-people-title">Property is<br />a people<br /><span>business.</span></h2><Link href="/team" className="cp-inline-link">Meet your people <Arrow /></Link></div><div className="cp-portraits">{people.map(person => <Link href="/team" key={person.name} aria-label={`Meet ${person.name}`}><img src={person.photo} alt={person.name} loading="lazy" /><span>{person.name}</span></Link>)}</div></div></section>

      <div className="cp-journal cp-wrap" id="cp-journal"><NewsSocialBoard compact /></div>

      <footer className="cp-footer" id="cp-contact"><div className="cp-wrap"><p className="cp-label">Something in mind?</p><a href={`mailto:${CONTACT.email}`} className="cp-footer-invitation">Let’s make<br />a connection.<Arrow /></a><div className="cp-contact-details"><a href={`tel:${CONTACT.phone.replace(/\D/g, "")}`}>{CONTACT.phone}</a><address>{CONTACT.addressLines.join(", ")}</address><div><a href="https://www.linkedin.com/company/bruce-gillingham-pollard" target="_blank" rel="noreferrer">LinkedIn ↗</a><a href="https://www.instagram.com/brucegillinghampollard/" target="_blank" rel="noreferrer">Instagram ↗</a></div></div><div className="cp-footer-base"><Link href="/concepts/pulse" aria-label="Bruce Gillingham Pollard home"><img src="/brand/bgp-block-nectar.svg" alt="" width="77" height="50" /></Link><span>© {new Date().getFullYear()} Bruce Gillingham Pollard</span><a href="https://www.brucegillinghampollard.com/privacy/" target="_blank" rel="noreferrer">Privacy policy ↗</a></div></div></footer>
    </div>
  );
}
