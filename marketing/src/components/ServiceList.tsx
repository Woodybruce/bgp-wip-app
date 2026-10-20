import { useId, useState } from "react";
import "./wire-typography.css";

export default function ServiceList({ services, heading = "What we offer", body, variant = "panel" }: { services: Array<{ name: string; detail: string }>; heading?: string; body?: string[]; variant?: "panel" | "list" }) {
  const [selected, setSelected] = useState(0);
  const id = useId();
  const current = services[selected] ?? services[0];
  const [lead, ...supportingCopy] = body ?? [];
  if (!services.length && !body?.length) return null;

  if (variant === "list") {
    return (
      <section className="service-list service-list--list site-container pb-14 md:pb-20">
        <div className="grid grid-cols-1 gap-10 border-t border-bgp-ink pt-10 md:grid-cols-[2fr_3fr] md:gap-16 md:pt-14">
          <div className="bg-bgp-mist p-6 md:p-8">
            <h2 className="service-list__sidebar-heading font-bold border-b border-bgp-ink pb-4">{heading}</h2>
            <ul className="divide-y divide-bgp-ink/25">
              {services.map((service) => <li key={service.name} className="service-list__sidebar-copy body-copy py-4 last:pb-0">{service.name}</li>)}
            </ul>
          </div>
          <div className="service-list__narrative space-y-5">
            {(body ?? []).map((paragraph, index) => <p key={paragraph} className={`body-copy ${index === 0 ? "font-bold" : ""}`}>{paragraph}</p>)}
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="service-list service-list--panel site-container pb-14 md:pb-20">
      <div className="grid grid-cols-1 gap-x-16 gap-y-8 border-t border-bgp-ink pt-10 md:grid-cols-[2fr_3fr] md:pt-14">
        <h2 className="service-list__heading section-title">{heading}</h2>
        <div className="service-list__intro">{lead && <p className="body-copy">{lead}</p>}</div>
        <div role="tablist" aria-label={heading} aria-orientation="vertical" className="flex flex-col items-start gap-1">
          {services.map((service, index) => (
            <button
              key={service.name}
              id={`${id}-tab-${index}`}
              role="tab"
              type="button"
              aria-selected={selected === index}
              aria-controls={`${id}-panel`}
              tabIndex={selected === index ? 0 : -1}
              onClick={() => setSelected(index)}
              onKeyDown={(event) => {
                let next: number;
                if (event.key === "ArrowDown") next = (index + 1) % services.length;
                else if (event.key === "ArrowUp") next = (index - 1 + services.length) % services.length;
                else if (event.key === "Home") next = 0;
                else if (event.key === "End") next = services.length - 1;
                else return;
                event.preventDefault();
                setSelected(next);
                document.getElementById(`${id}-tab-${next}`)?.focus();
              }}
              className={`service-list__tab min-h-11 py-2 text-left leading-[1.2] hover:text-bgp-wine ${selected === index ? "font-bold text-bgp-wine" : "text-bgp-ink"}`}
            >
              <span className="mr-3" aria-hidden="true">—</span>{service.name}
            </button>
          ))}
        </div>
        {current && (
          <div id={`${id}-panel`} role="tabpanel" aria-labelledby={`${id}-tab-${selected}`} tabIndex={0} className="service-list__detail flex min-h-[240px] flex-col bg-bgp-mist p-7 md:p-10">
            <h3 className="font-bold">{current.name}</h3>
            <p className="body-copy mt-4">{current.detail}</p>
            {services.length > 1 && <button type="button" onClick={() => setSelected((selected + 1) % services.length)} aria-label="Next service" className="mt-auto min-h-11 min-w-11 self-end px-3 pt-6 text-base text-bgp-wine underline-offset-4 hover:underline">Next</button>}
          </div>
        )}
        {supportingCopy.length > 0 && (
          <div className="service-list__supporting space-y-5 md:col-start-2">
            {supportingCopy.map((paragraph) => <p key={paragraph} className="body-copy">{paragraph}</p>)}
          </div>
        )}
      </div>
    </section>
  );
}
