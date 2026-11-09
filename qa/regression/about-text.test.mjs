import assert from 'node:assert/strict';
import test from 'node:test';
import { aboutText } from '../../client/src/lib/about-text.ts';

test('ChatBGP provenance notes never read as the About copy', () => {
  assert.equal(aboutText('Created by ChatBGP cleanup 28 Sep 2026 - agent firm identified from email domain during Mar 2026 requirements-import employer correction.'), '');
  assert.equal(aboutText('Tenant rep client — retail occupier. Added via ChatBGP when logging Google, 6 Pancras Square deal.'), 'Tenant rep client — retail occupier.');
  assert.equal(aboutText('The concept was created by founder Romain Bourrillon.'), 'The concept was created by founder Romain Bourrillon.');
});

test('research tags still become their own source paragraph', () => {
  assert.equal(aboutText("Nando's is a chain. [Propel Aug 2026] More."), "Nando's is a chain.\n\nPropel, Aug 2026: More.");
});
