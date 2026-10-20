import { useState } from "react";
import { Link } from "wouter";
import { HERO_STATEMENT, HOME_INTRO, LEASING_SECTORS, SERVICES, TESTIMONIAL } from "../lib/content";
import { useSiteContent } from "../lib/site-content";
import { ATIS_IMAGE, ATIS_IMAGE_ALT } from "../lib/design-imagery";
import NewsSocialBoard from "../components/NewsSocialBoard";
import "./home-redesign.css";

const scenes = [
  { image: "/images/hero/portman-chiltern-street.jpg", alt: "Independent shops and cafés along Chiltern Street", title: "The Portman Estate", label: "London Estates", href: "/leasing/sectors/london-estates" },
  { image: ATIS_IMAGE, alt: ATIS_IMAGE_ALT, title: "atis, Loxton Walk", label: "Brand representation", href: "/case-studies/atis-loxton-walk" },
  { image: "/images/case-studies/landsec/westgate/westgate-8.jpg", alt: "The restaurant terrace at Westgate, Oxford", title: "Westgate, Oxford", label: "Shopping Centres", href: "/case-studies/westgate-oxford" },
  { image: "/images/hero/royal-exchange.jpg", alt: "The Royal Exchange in the City of London", title: "The Royal Exchange", label: "Investment", href: "/case-studies/the-royal-exchange" },
];
const sectorOrder = ["shopping-centres", "london-estates", "high-streets", "city"];
const sectorImages: Record<string, string> = {
  "shopping-centres": "/images/case-studies/landsec/trinity/trinity-2.jpg",
  "london-estates": "/images/gallery/chiltern-street.jpg",
  "high-streets": "/images/st-christophers-place.jpg",
  city: "/images/hero/canary-wharf.jpg",
};
// Existing homepage figures, with their original scope.
const figures = [
  ["244", "Leasing transactions completed"],
  ["£62m", "Largest single transaction"],
  ["66", "Brands advised in the UK and abroad"],
  ["20+", "Years advising Canary Wharf Group"],
];

export default function Home() {
  const { caseStudies, team } = useSiteContent();
  const [scene, setScene] = useState(0);
  const [expertise, setExpertise] = useState("leasing");
  const current = scenes[scene];
  const service = SERVICES.find(item => item.slug === expertise) || SERVICES[0];
  const projects = ["westgate-oxford", "percival-neal-street", "the-royal-exchange"]
    .map(slug => caseStudies.find(project => project.slug === slug))
    .filter((project): project is NonNullable<typeof project> => !!project?.image);
  const sectors = sectorOrder.map(slug => LEASING_SECTORS.find(item => item.slug === slug)!);
  const people = ["Charlotte Roberts", "Harry Elliott", "Peter Wood", "Tracey Pollard"]
    .map(name => team.find(person => person.name === name))
    .filter((person): person is NonNullable<typeof person> => !!person?.photo);

  return (
    <div className="new-home">
      <section className="retail-intro" aria-labelledby="retail-title">
        <p className="retail-eyebrow">Bruce Gillingham Pollard</p>
        <h1 id="retail-title">{HOME_INTRO.lead}</h1>
        <p className="retail-intro__line">{HERO_STATEMENT}</p>
        <div className="retail-actions">
          <a href="#our-places" className="retail-button">Leasing</a>
          <Link href="/leasing#availability" className="retail-text-link">Available properties</Link>
        </div>
      </section>
      <section className="retail-stage" aria-label="Places and brands we work with">
        <div className="retail-stage__photograph">
          <img key={current.image} src={current.image} alt={current.alt} loading="eager" />
          <div className="retail-stage__shade" />
          <div className="retail-stage__caption" aria-live="polite">
            <div><p>{current.label}</p><h2>{current.title}</h2></div>
            <Link href={current.href} className="retail-round-link" aria-label={`Explore ${current.title}`}>View</Link>
          </div>
        </div>
        <div className="retail-stage__controls">
          <p>Bruce Gillingham Pollard</p>
          <div aria-label="Choose a featured place" className="retail-stage__dots">
            {scenes.map((item, index) => <button type="button" key={item.title} aria-label={`Show ${item.title}`} aria-pressed={scene === index} onClick={() => setScene(index)}><span /></button>)}
            <span className="retail-stage__number" aria-hidden>0{scene + 1} / 04</span>
          </div>
        </div>
      </section>
      <section className="retail-about retail-wrap" aria-labelledby="about-heading">
        <div><h2 id="about-heading">Bruce Gillingham<br /><span>Pollard</span></h2></div>
        <div className="retail-about__copy">
          <p>{HOME_INTRO.body[0]}</p>
          <details><summary>Find out more <span aria-hidden>+</span></summary><div>{HOME_INTRO.body.slice(1).map(paragraph => <p key={paragraph}>{paragraph}</p>)}</div></details>
        </div>
      </section>
      <section className="retail-work" id="our-work" aria-labelledby="work-heading">
        <div className="retail-wrap retail-section-head">
          <div><h2 id="work-heading">Case studies</h2></div>
          <Link href="/leasing" className="retail-text-link">Find out more</Link>
        </div>
        <div className="retail-work__grid retail-wrap">
          {projects.map((project, index) => <Link key={project.slug} href={`/case-studies/${project.slug}`} className={`retail-project retail-project--${index + 1}`}>
            <div className="retail-project__image"><img src={project.image} alt={project.title} loading="lazy" /></div>
            <div className="retail-project__caption"><p className="retail-eyebrow">{project.service}</p><h3>{project.title}</h3><p>{project.blurb}</p></div>
          </Link>)}
        </div>
      </section>
      <section className="retail-expertise retail-wrap" id="expertise" aria-labelledby="expertise-heading">
        <div className="retail-section-head"><div><h2 id="expertise-heading">{HOME_INTRO.servicesHeading}</h2></div></div>
        <div className="retail-expertise__grid">
          <div className="retail-expertise__image"><img key={service.image} src={service.image} alt={service.name} loading="lazy" /></div>
          <div className="retail-services">
            {SERVICES.map((item, index) => <div key={item.slug} className={`retail-service ${expertise === item.slug ? "is-open" : ""}`}>
              <h3><button type="button" aria-expanded={expertise === item.slug} aria-controls={`service-${item.slug}`} onClick={() => setExpertise(expertise === item.slug ? "" : item.slug)}><span className="retail-service__index">0{index + 1}</span>{item.name}<span className="retail-service__toggle" aria-hidden>{expertise === item.slug ? "−" : "+"}</span></button></h3>
              <div id={`service-${item.slug}`} hidden={expertise !== item.slug}><p>{item.intro}</p><Link href={`/${item.slug}`} className="retail-text-link">Explore {item.name.toLowerCase()}</Link></div>
            </div>)}
          </div>
        </div>
      </section>
      <section className="retail-places" id="our-places" aria-labelledby="places-heading">
        <div className="retail-wrap retail-section-head"><div><h2 id="places-heading">Leasing</h2></div><Link href="/leasing#availability" className="retail-text-link">View available properties</Link></div>
        <div className="retail-places__grid retail-wrap">
          {sectors.map(sector => <Link key={sector.slug} href={`/leasing/sectors/${sector.slug}`} className="retail-place">
            <div><img src={sectorImages[sector.slug]} alt={sector.name} loading="lazy" /></div>
            <h3>{sector.name}</h3>
          </Link>)}
        </div>
      </section>
      <section className="retail-quote retail-wrap" aria-label="Client perspective">
        <p className="retail-eyebrow">Landsec</p>
        <blockquote>“{TESTIMONIAL.quote}”</blockquote>
        <p className="retail-quote__author">{TESTIMONIAL.name}<span>{TESTIMONIAL.title}</span></p>
        <div className="retail-figures" aria-label="BGP in numbers">{figures.map(([value, caption]) => <div key={caption}><p>{value}</p><span>{caption}</span></div>)}</div>
      </section>
      <div className="retail-journal"><div className="retail-wrap"><NewsSocialBoard compact /></div></div>
      <section className="retail-people retail-wrap" aria-labelledby="people-heading">
        <div><h2 id="people-heading">The BGP team</h2><Link href="/team" className="retail-text-link">A–Z contact details</Link></div>
        <div className="retail-people__portraits">{people.map(person => <Link key={person.name} href="/team" aria-label={`Meet ${person.name}`}><img src={person.photo} alt={person.name} loading="lazy" /><span>{person.name}</span></Link>)}</div>
      </section>
    </div>
  );
}
