import { useId, useState } from "react";

export default function ServiceList({ services, heading = "What we offer", body, variant = "panel" }: { services: Array<{ name: string; detail: string }>; heading?: string; body?: string[]; variant?: "panel" | "list" }) {
  const [selected, setSelected] = useState(0);
  const id = useId();
  const current = services[selected] ?? services[0];
  if (!services.length && !body?.length) return null;

  if (variant === "list") {
    return (
      <section className="site-container pb-14 md:pb-20">
        <div className="grid grid-cols-1 gap-10 border-t border-bgp-ink pt-10 md:grid-cols-[2fr_3fr] md:gap-16 md:pt-14">
          <div className="bg-bgp-mist p-6 md:p-8">
            <h2 className="text-lg font-bold border-b border-bgp-ink pb-4">{heading}</h2>
            <ul className="divide-y divide-bgp-ink/25">
              {services.map((service) => <li key={service.name} className="body-copy py-4 last:pb-0">{service.name}</li>)}
            </ul>
          </div>
          <div className="space-y-5">
            {(body ?? []).map((paragraph, index) => <p key={paragraph} className={`body-copy ${index === 0 ? "font-bold" : ""}`}>{paragraph}</p>)}
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="site-container pb-14 md:pb-20">
      <div className="grid grid-cols-1 gap-x-16 gap-y-8 border-t border-bgp-ink pt-10 md:grid-cols-[2fr_3fr] md:pt-14">
        <h2 className="section-title">{heading}</h2>
        <div className="space-y-5">{body?.map((paragraph) => <p key={paragraph} className="body-copy">{paragraph}</p>)}</div>
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
              className={`min-h-11 py-2 text-left text-[18px] leading-[1.3] hover:text-bgp-wine ${selected === index ? "font-bold text-bgp-wine" : "text-bgp-ink"}`}
            >
              <span className="mr-3" aria-hidden="true">—</span>{service.name}
            </button>
          ))}
        </div>
        {current && (
          <div id={`${id}-panel`} role="tabpanel" aria-labelledby={`${id}-tab-${selected}`} tabIndex={0} className="flex min-h-[240px] flex-col bg-bgp-mist p-7 md:p-10">
            <h3 className="text-lg font-bold">{current.name}</h3>
            <p className="body-copy mt-4">{current.detail}</p>
            {services.length > 1 && <button type="button" onClick={() => setSelected((selected + 1) % services.length)} aria-label="Next service" className="mt-auto min-h-11 min-w-11 self-end pt-6 text-3xl text-bgp-wine">→</button>}
          </div>
        )}
      </div>
    </section>
  );
}
