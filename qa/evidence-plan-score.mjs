// Independent, post-run scoring of REAL automatically accepted units.
// This program has no provider or database access and never passes samples to detection.
// node --import tsx qa/evidence-plan-score.mjs --run=/absolute/provider/output --ground-truth=/absolute/sample.json
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { isValidPolygon, pointInPolygon } from '../shared/plan-geometry.ts';
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const text = value => String(value ?? '').normalize('NFKC').trim().replace(/\s+/g, ' ').toUpperCase();
const reference = value => text(value).replace(/^UNITS?\s+/, '').replace(/\s/g, '').replace(/(^|\D)0+(\d)/g, '$1$2');
const labelComparison = (expected, actual, kind) => expected == null ? {
  expectation: null, actual: actual || null, scored: false, reason: 'No readable printed label expectation was annotated',
} : {
  expectation: expected, actual: actual || null, scored: true,
  exactIgnoringCaseAndWhitespace: text(expected) === text(actual),
  formatNormalizedMatch: kind === 'reference' ? reference(expected) === reference(actual) : text(expected) === text(actual),
};
function standardize(sampleFile) {
  const brent = Array.isArray(sampleFile.samples);
  const positives = (brent ? sampleFile.samples : sampleFile.positives).map(sample => ({
    id: sample.id, point: sample.interior_normalized || sample.seed,
    expectedReference: brent ? sample.printed_ref : sample.printedUnitLabel,
    expectedTenant: brent ? sample.tenant_printed : null,
    description: sample.description || sample.boundary_remarks || '',
    shapeExpectation: sample.expected_shape || null,
    boundaryRemarks: sample.boundary_remarks || null,
    tenancyDemiseConfirmed: sample.tenancyDemiseConfirmed === true,
    safeRadiusX: sample.safeInteriorRadiusPx ? sample.safeInteriorRadiusPx / sampleFile.reviewImage.width : null,
    safeRadiusY: sample.safeInteriorRadiusPx ? sample.safeInteriorRadiusPx / sampleFile.reviewImage.height : null,
  }));
  const negatives = (brent ? sampleFile.controls : sampleFile.negatives).map(sample => ({
    id: sample.id, point: sample.interior_normalized || sample.seed, description: sample.label || sample.description || '', remarks: sample.remarks || null,
  }));
  const ids = new Set(positives.map(sample => sample.id));
  const pairs = brent ? sampleFile.samples.flatMap(sample => (sample.adjacency || []).filter(id => ids.has(id)).map(id => [sample.id, id]))
    : sampleFile.separateVisibleCompartments || [];
  const separatePairs = [...new Map(pairs.map(pair => { const sorted = [...pair].sort(); return [sorted.join('|'), sorted]; })).values()];
  for (const sample of [...positives, ...negatives]) {
    if (!sample.point || !Number.isFinite(sample.point.x) || !Number.isFinite(sample.point.y)
      || sample.point.x < 0 || sample.point.x > 1 || sample.point.y < 0 || sample.point.y > 1) throw new Error(`Invalid held-out point for ${sample.id}`);
  }
  if (new Set([...positives, ...negatives].map(sample => sample.id)).size !== positives.length + negatives.length) throw new Error('Duplicate sample/control IDs');
  return { positives, negatives, separatePairs, kind: brent ? 'sampled_demises' : 'sampled_visible_compartments', source: sampleFile };
}
export function scoreAcceptedUnits(acceptedUnits, sampleFile) {
  if (!Array.isArray(acceptedUnits)) throw new Error('Accepted scanner output must be a units array');
  const truth = standardize(sampleFile);
  const predictions = acceptedUnits.map((unit, index) => ({
    key: `${index + 1}:${unit.id || 'no-id'}`, id: unit.id || null, index,
    reference: unit.unit_ref || null, tenant: unit.tenant_name || null,
    polygon: unit.polygon, validPolygon: isValidPolygon(unit.polygon), source: unit.source || null,
  }));
  const contains = (prediction, sample) => prediction.validPolygon && pointInPolygon(sample.point, prediction.polygon);
  const describe = prediction => ({ key: prediction.key, id: prediction.id, reference: prediction.reference, tenant: prediction.tenant });
  const positiveAssociations = truth.positives.map(sample => {
    const matches = predictions.filter(prediction => contains(prediction, sample));
    return {
      sampleId: sample.id, description: sample.description, point: sample.point, tenancyDemiseConfirmed: sample.tenancyDemiseConfirmed,
      shapeExpectation: sample.shapeExpectation, boundaryRemarks: sample.boundaryRemarks,
      covered: matches.length > 0, coveringPredictionCount: matches.length,
      predictions: matches.map(prediction => ({
        ...describe(prediction),
        referenceComparison: labelComparison(sample.expectedReference, prediction.reference, 'reference'),
        tenantComparison: labelComparison(sample.expectedTenant, prediction.tenant, 'tenant'),
        interiorDiskProbe: sample.safeRadiusX ? {
          kind: 'Eight probes around the annotated safe interior radius; not a full boundary test',
          allContained: Array.from({ length: 8 }, (_, index) => ({ x: sample.point.x + Math.cos(index * Math.PI / 4) * sample.safeRadiusX,
            y: sample.point.y + Math.sin(index * Math.PI / 4) * sample.safeRadiusY })).every(point => pointInPolygon(point, prediction.polygon)),
        } : null,
      })),
      referenceExpectation: sample.expectedReference || null, tenantExpectation: sample.expectedTenant || null,
    };
  });
  const negativeAssociations = truth.negatives.map(sample => ({
    controlId: sample.id, description: sample.description, point: sample.point,
    leaked: predictions.some(prediction => contains(prediction, sample)),
    coveringPredictions: predictions.filter(prediction => contains(prediction, sample)).map(describe),
  }));
  const separationAssociations = truth.separatePairs.map(([a, b]) => {
    const left = truth.positives.find(sample => sample.id === a), right = truth.positives.find(sample => sample.id === b);
    if (!left || !right) throw new Error(`Unknown sample in separate pair ${a}/${b}`);
    const spans = predictions.filter(prediction => contains(prediction, left) && contains(prediction, right));
    return { samples: [a, b], sharedPredictionCount: spans.length, merged: spans.length > 0, predictions: spans.map(describe),
      interpretation: truth.kind === 'sampled_demises' ? 'Distinct sampled demises must remain separate.' : 'Distinct visible compartments spanned by one polygon; inspect boundaries. The source does not establish separate legal tenancies.' };
  });
  const predictionAssociations = predictions.map(prediction => ({
    ...describe(prediction), validPolygon: prediction.validPolygon,
    positiveSampleIds: truth.positives.filter(sample => contains(prediction, sample)).map(sample => sample.id),
    negativeControlIds: truth.negatives.filter(sample => contains(prediction, sample)).map(sample => sample.id),
    mergedSeparatePairs: separationAssociations.filter(pair => pair.predictions.some(item => item.key === prediction.key)).map(pair => pair.samples),
  }));
  const refEligible = positiveAssociations.filter(sample => sample.referenceExpectation != null);
  const tenantEligible = positiveAssociations.filter(sample => sample.tenantExpectation != null);
  const associationHasLabel = (sample, key, comparison) => sample.predictions.some(prediction => prediction[key][comparison] === true);
  const summary = {
    scope: truth.kind,
    acceptedPredictions: predictions.length,
    validPolygonPredictions: predictions.filter(prediction => prediction.validPolygon).length,
    positiveCoverage: { covered: positiveAssociations.filter(sample => sample.covered).length, sampled: positiveAssociations.length,
      missedSampleIds: positiveAssociations.filter(sample => !sample.covered).map(sample => sample.sampleId),
      multiplyCoveredSampleIds: positiveAssociations.filter(sample => sample.coveringPredictionCount > 1).map(sample => sample.sampleId) },
    negativeLeakage: { leaked: negativeAssociations.filter(control => control.leaked).length, controls: negativeAssociations.length,
      leakedControlIds: negativeAssociations.filter(control => control.leaked).map(control => control.controlId) },
    adjacentSeparation: { mergedPairs: separationAssociations.filter(pair => pair.merged).length, testedPairs: separationAssociations.length,
      mergedSamplePairs: separationAssociations.filter(pair => pair.merged).map(pair => pair.samples) },
    readableReferenceRecognitionAtCorrectLocation: { eligibleSamples: refEligible.length,
      exactIgnoringCaseAndWhitespace: refEligible.filter(sample => associationHasLabel(sample, 'referenceComparison', 'exactIgnoringCaseAndWhitespace')).length,
      formatNormalized: refEligible.filter(sample => associationHasLabel(sample, 'referenceComparison', 'formatNormalizedMatch')).length,
      normalization: 'Case, whitespace, leading Unit/Units, and leading numeric zeros only; no fuzzy/range/tenant guessing.' },
    readableTenantRecognitionAtCorrectLocation: { eligibleSamples: tenantEligible.length,
      exactIgnoringCaseAndWhitespace: tenantEligible.filter(sample => associationHasLabel(sample, 'tenantComparison', 'exactIgnoringCaseAndWhitespace')).length },
    acceptedPredictionsWithoutAnySampleOrControl: predictionAssociations.filter(prediction => !prediction.positiveSampleIds.length && !prediction.negativeControlIds.length).length,
    limitations: [
      'Point coverage is not boundary accuracy. Inspect returns, walls, exclusions and labels visually; no polygon IoU is available from these point annotations.',
      'This independent annotation sample is not a complete census or a held-out evaluation after iterative development. Predictions outside the samples remain unscored, not presumed correct or false.',
      'Readable-label scores apply only to explicit non-null ground-truth labels at the correct sampled location. A null label expectation is not guessed.',
      ...(sampleFile.limitations || []),
      ...(sampleFile.shape_scoring_limit ? [sampleFile.shape_scoring_limit] : []),
    ],
  };
  return { summary, positiveAssociations, negativeAssociations, separationAssociations, predictionAssociations };
}
function validateSource(manifest, sampleFile) {
  if (sampleFile.source?.sha256) {
    if (manifest.image.sha256 !== sampleFile.source.sha256 || manifest.image.width !== sampleFile.source.width || manifest.image.height !== sampleFile.source.height) throw new Error('Provider image does not match the independent ground-truth source hash/frame');
    return { verifiedBy: 'Source SHA-256 and dimensions', sha256: manifest.image.sha256 };
  }
  const name = path.basename(manifest.image.path);
  const frame = [sampleFile.reviewImage, sampleFile.liveImage].find(image => image?.file === name && image.width === manifest.image.width && image.height === manifest.image.height);
  if (!frame) throw new Error('Provider image does not match either independently documented Brixton crop frame');
  return { verifiedBy: 'Filename and dimensions of the independently documented aligned crop frame; ground truth does not provide an image SHA-256',
    imageSha256: manifest.image.sha256, coordinateProvenance: sampleFile.coordinates };
}
function selfTest() {
  const polygon = (x0, y0, x1, y1) => [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];
  const samples = { positives: [
    { id: 'a', seed: { x: .2, y: .3 }, printedUnitLabel: 'Unit D01', tenancyDemiseConfirmed: false },
    { id: 'b', seed: { x: .4, y: .3 }, printedUnitLabel: null, tenancyDemiseConfirmed: false },
    { id: 'miss', seed: { x: .9, y: .9 }, printedUnitLabel: null, tenancyDemiseConfirmed: false },
  ], negatives: [{ id: 'road', seed: { x: .3, y: .3 } }], separateVisibleCompartments: [['a', 'b']] };
  const score = scoreAcceptedUnits([
    { id: 'merged', unit_ref: 'D1', polygon: polygon(.1, .2, .5, .4) },
    { id: 'outside-sample', unit_ref: 'Unknown', polygon: polygon(.6, .6, .7, .7) },
  ], samples);
  assert.equal(score.summary.positiveCoverage.covered, 2);
  assert.deepEqual(score.summary.positiveCoverage.missedSampleIds, ['miss']);
  assert.equal(score.summary.negativeLeakage.leaked, 1);
  assert.equal(score.summary.adjacentSeparation.mergedPairs, 1);
  assert.equal(score.summary.readableReferenceRecognitionAtCorrectLocation.eligibleSamples, 1);
  assert.equal(score.summary.readableReferenceRecognitionAtCorrectLocation.formatNormalized, 1);
  assert.equal(score.summary.acceptedPredictionsWithoutAnySampleOrControl, 1);
  assert.equal(score.positiveAssociations.find(sample => sample.sampleId === 'b').predictions[0].referenceComparison.scored, false);
  const brent = { samples: [{ id: 'shop', interior_normalized: { x: .2, y: .3 }, printed_ref: 'A1', tenant_printed: 'Example', adjacency: [] }], controls: [] };
  const misplaced = scoreAcceptedUnits([{ id: 'wrong-place', unit_ref: 'A1', tenant_name: 'Example', polygon: polygon(.6, .6, .7, .7) }], brent);
  assert.equal(misplaced.summary.readableReferenceRecognitionAtCorrectLocation.formatNormalized, 0);
  assert.equal(misplaced.summary.readableTenantRecognitionAtCorrectLocation.exactIgnoringCaseAndWhitespace, 0);
  console.log('PASS scorer self-test: positive/missed samples, negatives, merged neighbours, unscored extras, label normalization and wrong-location labels. Synthetic scorer checks only; no automatic detection run.');
}
async function main() {
  const args = Object.fromEntries(process.argv.slice(2).map(arg => { const split = arg.indexOf('='); return [arg.slice(2, split < 0 ? undefined : split), split < 0 ? true : arg.slice(split + 1)]; }));
  if (args['self-test']) { selfTest(); return; }
  if (!args['ground-truth']) throw new Error('Provide --ground-truth=/absolute/independent-sample.json');
  const truthPath = path.resolve(args['ground-truth']), truthBytes = fs.readFileSync(truthPath), truth = JSON.parse(truthBytes);
  const normalized = standardize(truth);
  if (args['prepare-only']) {
    console.log(JSON.stringify({ stage: 'scorer_preparation_only_no_predictions_scored', samplePath: truthPath, sampleSha256: hash(truthBytes), positives: normalized.positives.length, negativeControls: normalized.negatives.length, separateAdjacentPairs: normalized.separatePairs.length, scope: normalized.kind }, null, 2));
    return;
  }
  if (!args.run) throw new Error('Provide --run=/absolute/actual-provider-output');
  const run = path.resolve(args.run), output = path.resolve(args.out || path.join(run, 'independent-score'));
  const manifestBytes = fs.readFileSync(path.join(run, 'manifest.json')), manifest = JSON.parse(manifestBytes);
  const resultBytes = fs.readFileSync(path.join(run, 'summary.json')), result = JSON.parse(resultBytes);
  if (result.stage !== 'actual_automatic_pipeline_completed' || !(result.providerUsage?.completed > 0)) throw new Error('Scoring requires output from actual provider calls; preparation/candidate-only data is not an automatic scan result');
  const sourceValidation = validateSource(manifest, truth);
  const acceptedBytes = fs.readFileSync(path.join(run, 'automatically-saved-units.json'));
  const score = scoreAcceptedUnits(JSON.parse(acceptedBytes), truth);
  fs.mkdirSync(output, { recursive: true });
  if (fs.existsSync(path.join(output, 'summary.json'))) throw new Error('Use a new --out directory to preserve previous scores');
  const provenance = {
    scoredAt: new Date().toISOString(), stage: 'independent_post_run_sample_scoring',
    separationFromDetection: 'Independent annotation file read only after actual provider output exists. This scorer never feeds points/labels to a provider or modifies predictions.',
    files: { run, groundTruth: truthPath, manifestSha256: hash(manifestBytes), runSummarySha256: hash(resultBytes), acceptedUnitsSha256: hash(acceptedBytes), groundTruthSha256: hash(truthBytes), scorerSha256: hash(fs.readFileSync(fileURLToPath(import.meta.url))) },
    sourceValidation, automaticRun: { case: result.case, sourceHead: result.sourceHead, jobStatus: result.jobStatus, providerUsage: result.providerUsage, reviewDetails: result.reviewDetails, providerRequestCapReached: result.providerRequestCapReached },
  };
  const compact = { ...provenance, ...score.summary };
  fs.writeFileSync(path.join(output, 'summary.json'), JSON.stringify(compact, null, 2));
  fs.writeFileSync(path.join(output, 'associations.json'), JSON.stringify({ ...provenance, ...score }, null, 2));
  console.log(JSON.stringify(compact, null, 2));
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
