import React from 'react';
import { createRoot } from 'react-dom/client';
import { ChatResponse } from '../../client/src/components/chat-response';
import '../../client/src/index.css';
const email = `I have retained your £50,000 per court assumption and kept the 20% turnover scenario separate.

Subject: Thameside West — initial leisure opportunities

Dear Paul and Jamie,

Following our discussions, below is our initial framework for the leisure offer.

Use | Indicative area | Rent per sq ft pa | Potential tenants
--- | --- | --- | ---
Boutique cinema | 15,000 sq ft | £15 | Everyman, Curzon, Picturehouse
Padel with café/bar | 25,000 sq ft overall | £14 blended | Padium, Padel Social Club
Gym and wellness | 15,000–20,000 sq ft | £15–£20 | Third Space, Virgin Active

**Padel and associated hospitality**

The proposed offer comprises six indoor courts and one outdoor court, with a café/bar, reception, changing facilities and social space.

Area: approximately 25,000 sq ft overall
Rent: £350,000 pa (£50,000 × seven courts)
Blended rate: £14 per sq ft pa

These are working assumptions based on the notes supplied, subject to layout and operator review.

Kind regards,
Woody`;
function App(){ return <main className="mx-auto max-w-4xl p-4 md:p-8"><div className="mb-6 border-b pb-4"><p className="text-xs font-medium uppercase tracking-widest text-primary">BGP · chat review</p><h1 className="mt-2 text-2xl font-semibold">A draft you can use</h1><p className="mt-2 text-sm text-muted-foreground">Local test using the supplied padel example. No live email or AI request.</p></div><ChatResponse content={email}/><section className="mt-8 border-t pt-5"><h2 className="mb-2 font-medium">Paste check</h2><p className="mb-3 text-sm text-muted-foreground">Copy the email above, then paste here to inspect the actual clipboard result.</p><div aria-label="Paste check" role="textbox" contentEditable suppressContentEditableWarning className="min-h-40 overflow-auto border bg-white p-4 text-black"/></section></main> }
createRoot(document.getElementById('root')!).render(<App/>);
