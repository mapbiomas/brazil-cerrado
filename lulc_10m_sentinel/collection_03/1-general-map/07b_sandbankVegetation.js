// --- --- --- 07b_sandbankVegetation
// Identify and classify Herbaceous Sandbank Vegetation (Restinga Herbácea) using satellite embeddings and ecological constraints
// barbara.silva@ipam.org.br, dhemerson.costa@ipam.org.br and ana.souza@ipam.org.br

// Import MapBiomas color palette
var vis = {
  min: 0,
  max: 62,
  palette: require('users/mapbiomas/modules:Palettes.js').get('classification8'),
  bands: 'classification_2020'
};

// Classification input/output settings
var inputVersion = '9';
var outputVersion = '4';
var input = 'projects/mapbiomas-workspace/COLECAO_DEV/COLECAO10_DEV/CERRADO/SENTINEL/C03-POST-CLASSIFICATION/';
var output = 'projects/mapbiomas-workspace/COLECAO_DEV/COLECAO10_DEV/CERRADO/SENTINEL/C03-POST-CLASSIFICATION/';

var inputFile = 'CERRADO_C03_gapfill_v' + inputVersion;
var classificationInput = ee.Image(input + inputFile);

// Generic sample points (non-sandbank veg classes)
var classes = ee.FeatureCollection(
  'projects/mapbiomas-workspace/COLECAO_DEV/COLECAO10_DEV/CERRADO/SENTINEL/sample/points/samplePoints_v3'
);

// Sandbank vegetation training samples (all years)
var sandbankSamples = ee.FeatureCollection(
  'projects/mapbiomas-workspace/COLECAO_DEV/COLECAO10_DEV/CERRADO/SENTINEL/trainings/restinga/train_col03_restinga_all_years_v0'
);

// Select Cerrado classification region 1
var region1 = ee.FeatureCollection(
  'users/dh-conciani/collection7/classification_regions/vector_v2'
).filter(ee.Filter.eq('mapb', 1));

// Coastal deposits mask (Brazilian Geological Service - CPRM/SGB)
var coastalDeposits = ee.Image(
  'projects/barbaracosta-ipam/assets/base/CPRM_coastal-deposits'
).select('first').clip(region1);

// Geometry used throughout the analysis
var roiMask = coastalDeposits.selfMask();
var roiGeom = roiMask.geometry();

// Filter samples spatially
var fcSandbank = sandbankSamples
  .filterBounds(roiGeom)
  .filter(ee.Filter.eq('class', 50));

var fcOthers = classes.filterBounds(roiGeom);

// Randomly subsample "other classes" to balance the dataset
fcOthers = fcOthers
  .randomColumn('rand')
  .sort('rand')
  .limit(1360);

// Diagnostics
print('Total generic samples:', classes.size());
print('Total sandbank veg samples:', sandbankSamples.size());
print('Generic samples inside ROI:', fcOthers.size());
print('Sandbank veg samples inside ROI:', fcSandbank.size());

// Define target labels
// target = 1 → Sandbank veg
// target = 0 → Other land cover classes
var othersLabeled = fcOthers.map(function (f) {
  return f.set('target', 0);
});

var sandbankLabeled = fcSandbank.map(function (f) {
  return f.set('target', 1);
});

// Merge final training samples
var samples = othersLabeled.merge(sandbankLabeled);

Map.addLayer(samples, {}, 'Training samples (ROI)');

// Annual satellite embeddings (Google Satellite Embedding model)
var embeddingAsset = 'GOOGLE/SATELLITE_EMBEDDING/V1/ANNUAL';

var embeddings = ee.ImageCollection(embeddingAsset)
  .filterDate('2020-01-01', '2021-01-01')
  .filterBounds(roiGeom)
  .mosaic();

Map.addLayer(embeddings, {}, 'Satellite embeddings');

var bandNames = embeddings.bandNames();

// Sample embeddings at training points
var samplesWithEmbeddings = embeddings.sampleRegions({
  collection: samples,
  scale: 10,
  geometries: true
});

print('Total samples with embeddings:', samplesWithEmbeddings.size());

// Split by class
var sandbank = samplesWithEmbeddings.filter(ee.Filter.eq('target', 1));
var others = samplesWithEmbeddings.filter(ee.Filter.eq('target', 0));

// ======================================================================
// FEATURE SEPARABILITY ANALYSIS
// ======================================================================

// Computes F-score per embedding band to evaluate class separability
var fScores = bandNames.map(function (band) {

  var r = sandbank.aggregate_array(band);
  var o = others.aggregate_array(band);

  var meanR = ee.Number(r.reduce(ee.Reducer.mean()));
  var meanO = ee.Number(o.reduce(ee.Reducer.mean()));
  var varR  = ee.Number(r.reduce(ee.Reducer.variance()));
  var varO  = ee.Number(o.reduce(ee.Reducer.variance()));

  var numerator   = meanR.subtract(meanO).pow(2);
  var denominator = varR.add(varO);

  var f = numerator.divide(denominator);

  return ee.Feature(null, {
    band: band,
    fscore: f
  });
});

// Rank bands by separability
var rankedFScores = ee.FeatureCollection(fScores).sort('fscore', false);

print('Embedding band separability ranking (F-score):', rankedFScores);

// Selected best embedding band (from F-score ranking)
var bestBand = 'A18';

// Compute class means
var meanRest = ee.Number(
  sandbank.reduceColumns(ee.Reducer.mean(), [bestBand]).get('mean')
);

var meanOther = ee.Number(
  others.reduceColumns(ee.Reducer.mean(), [bestBand]).get('mean')
);

// Initial midpoint threshold (reference)
var midThreshold = meanRest.add(meanOther).divide(2);

print('Mean Sandbank veg:', meanRest);
print('Mean Other:', meanOther);
print('Midpoint threshold:', midThreshold);

// Function to compute optimal threshold using Youden’s J
function findOptimalThreshold(restList, otherList) {

  restList  = ee.List(restList);
  otherList = ee.List(otherList);

  var values = restList.cat(otherList).distinct().sort();

  var stats = values.map(function (th) {
    th = ee.Number(th);

    var sens = restList.map(function (v) {
      return ee.Number(v).gt(th);
    }).reduce(ee.Reducer.mean());

    var spec = otherList.map(function (v) {
      return ee.Number(v).lte(th);
    }).reduce(ee.Reducer.mean());

    var J = ee.Number(sens).add(spec).subtract(1);

    return ee.Feature(null, {
      threshold: th,
      J: J,
      sensitivity: sens,
      specificity: spec
    });
  });

  return ee.Number(
    ee.FeatureCollection(stats).sort('J', false).first().get('threshold')
  );
}

var optimalThreshold = findOptimalThreshold(
  sandbank.aggregate_array(bestBand),
  others.aggregate_array(bestBand)
);

print('Optimal threshold (Youden J):', optimalThreshold);

// ======================================================================
// ECOLOGICAL AND GEOLOGICAL CONSTRAINTS
// ======================================================================
// HAND (floodplain/wetland proxy)
var hand = ee.Image('MERIT/Hydro/v1_0_1')
  .select('hnd')
  .clip(region1);

// Spectral criterion
var maskSpectral = embeddings.select(bestBand).gt(optimalThreshold);

// Ecological criterion (low HAND)
var maskHAND = hand.lt(3); // adjustable threshold

// Geological criterion (coastal deposits)
var maskCPRM = roiMask;

// Final Sandbank veg mask
var sandbankMask = maskSpectral
  .and(maskHAND)
  .and(maskCPRM)
  .selfMask();

Map.addLayer(hand, {min: 0, max: 30, palette: ['white', 'blue']}, 'HAND');
Map.addLayer(sandbankMask, {palette: ['yellow']}, 'Detected Sandbank veg mask');

// Apply sandbank mask to annual classification
var updatedClassification = ee.Image([]);
var years = ee.List.sequence(2017, 2024);

years.getInfo().forEach(function (year) {

  var bandName = 'classification_' + year;
  var original = classificationInput.select(bandName);

  // Eligible classes for conversion to Sandbank vegetation
  var eligible = original.eq(4)   // Savanna
    .or(original.eq(11))          // Grassland
    .or(original.eq(12));         // Wetland

  var updated = original.where(
    eligible.and(sandbankMask),
    50
  );

  updatedClassification = updatedClassification.addBands(
    updated.rename(bandName)
  );
});

Map.addLayer (updatedClassification, vis, 'Updated classification with Sandbank veg');

// Export as GEE asset
Export.image.toAsset({
  image: updatedClassification,
  description: inputFile + '_sandbank_v' + outputVersion,
  assetId: output + inputFile + '_sandbank_v' + outputVersion,
  pyramidingPolicy: {'.default': 'mode'},
  region: updatedClassification.geometry(),
  scale: 10,
  maxPixels: 1e13
});


