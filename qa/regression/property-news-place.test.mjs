import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { isAboutPlace, isReferencePage, isSharedName, namesElsewhere, postcodeAnchors } from '../../server/property-news-place.ts';
process.env.DATABASE_URL ||= 'postgres://test@127.0.0.1:1/test';
const { isOpeningHeadline } = await import('../../server/centre-openings.ts');

// The Royal Exchange, Bank, London EC3V 3LR — landlord Ardent.
const rex = {
  names: ['Royal Exchange', 'the royal exchange'],
  anchors: ['London', 'Bank', ...postcodeAnchors('EC3V 3LR'), 'ardent'],
  lat: 51.5136093, lng: -0.0874577,
};

test('Manchester Royal Exchange Theatre stories are not the City arcade', () => {
  // Title + snippet as the Google News search returned them (Woody, 2026-09-28).
  for (const text of [
    "Costumes the stars at Royal Exchange's spectacular anniversary exhibition Costumes the stars at Royal Exchange's spectacular anniversary exhibition  Lancashire Telegraph",
    'Rehearsal images revealed for King Lear at the Royal Exchange Theatre Rehearsal images revealed for King Lear at the Royal Exchange Theatre  Northern Arts Review',
    'A Little Night Music A Little Night Music - Royal Exchange Theatre  voicemag.uk',
    "Royal Exchange: Costume exhibition celebrates 50 years of city's 'spaceship-like' theatre Royal Exchange: Costume exhibition celebrates 50 years of city's 'spaceship-like' theatre  BBC",
  ]) assert.equal(isAboutPlace(text, rex), false, text);
});

test('Britannica and wiki pages are reference, not news', () => {
  assert.equal(isReferencePage({ title: 'Royal Exchange and Lloyds Banks Group in London', sourceName: 'Britannica', url: 'https://news.google.com/rss/articles/CBMi' }), true);
  assert.equal(isReferencePage({ title: 'Royal Exchange, London', sourceName: '', url: 'https://en.wikipedia.org/wiki/Royal_Exchange,_London' }), true);
  assert.equal(isReferencePage({ title: 'Ladurée Unveils Upgraded Store at The Royal Exchange', sourceName: 'Retail & Leisure International', url: 'https://www.retail-leisure-international.com/x' }), false);
});

test('City of London Royal Exchange retail news stays', () => {
  for (const text of ['Ladurée Unveils Upgraded Store at The Royal Exchange', 'French macaron maker opens expanded store at The Royal Exchange',
    'Ardent puts the Royal Exchange up for sale', 'Royal Exchange, London: new dining terrace', 'Royal Exchange in the City of London draws bids'])
    assert.equal(isAboutPlace(text, rex), true, text);
});

test('a building placed in another town is rejected for any name', () => {
  for (const text of ["Anthropologie set to open flagship store in Manchester’s Royal Exchange", 'Anthropologie opens at the Royal Exchange, Manchester',
    'Royal Exchange Manchester signs Anthropologie', 'New store for the Royal Exchange in Manchester'])
    assert.equal(namesElsewhere(text, rex), true, text);
  assert.equal(namesElsewhere('Ladurée Unveils Upgraded Store at The Royal Exchange', rex), false);
  // A nearby town is home: Bluewater and Dartford.
  const bluewater = { names: ['Bluewater Shopping Centre', 'Bluewater'], anchors: [], lat: 51.4388, lng: 0.2716 };
  assert.equal(namesElsewhere('Next opens at Bluewater, Dartford', bluewater), false);
  assert.equal(namesElsewhere("Leeds' Corn Exchange welcomes a new cafe", { names: ['Corn Exchange'], anchors: ['Brighton'], lat: 50.824, lng: -0.137 }), true);
  assert.equal(isOpeningHeadline('Anthropologie set to open flagship store in Manchester’s Royal Exchange'), true, 'the opening filter alone let it through');
});

test('shared names need an anchor; distinctive names do not', () => {
  for (const name of ['Royal Exchange', 'The Royal Exchange', 'Corn Exchange', 'The Arcade', 'Grand Central Shopping Centre', 'Castle Quarter', 'Church Street'])
    assert.equal(isSharedName(name), true, name);
  for (const name of ['Bluewater Shopping Centre', 'Brixton Village', 'Covent Garden', 'Hudson Yard, Vauxhall', 'Lucent'])
    assert.equal(isSharedName(name), false, name);
  const bluewater = { names: ['Bluewater Shopping Centre'], anchors: ['Greenhithe'], lat: 51.4388, lng: 0.2716 };
  assert.equal(isAboutPlace('Bluewater celebrates 25 years', bluewater), true);
  assert.equal(isAboutPlace('Royal Exchange celebrates 25 years', rex), false);
  assert.equal(isAboutPlace('Royal Exchange celebrates 25 years in the Square Mile', rex), true);
  // Unanchored retail news set in another town belongs to that town.
  assert.equal(isAboutPlace('Anthropologie flagship store opens as Manchester shoppers queue at Royal Exchange', rex), false);
  // An address with no town still has its pin: Kings Cross, London.
  const kx = { names: ['Kings Cross'], anchors: [], lat: 51.5347, lng: -0.1246 };
  assert.equal(isAboutPlace("Microsoft in talks for major London office move in King's Cross Knowledge Quarter", kx), true);
  assert.equal(isAboutPlace('Kings Cross Steelers win international gay rugby tournament, the Bingham Cup', kx), false);
});

test('property news and centre openings both run the place filter', () => {
  const news = readFileSync(new URL('../../server/news-feeds.ts', import.meta.url), 'latin1');
  assert.match(news, /isReferencePage\(a\)/);
  assert.match(news, /isAboutPlace\(`\$\{r\.title\} \$\{r\.snippet\}`, placeCtx\)/);
  const openings = readFileSync(new URL('../../server/centre-openings.ts', import.meta.url), 'utf8');
  assert.equal((openings.match(/\|\| elsewhere\(/g) || []).length >= 3, true);
  assert.match(openings, /centre-openings:v9:/);
});
