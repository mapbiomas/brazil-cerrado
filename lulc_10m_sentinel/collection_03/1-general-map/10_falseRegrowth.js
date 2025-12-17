// -- -- -- -- 10_falseRegrowth
// post-processing filter: temporal post-classification filters to remove false regrowth signals (native vegetation) in annual LULC maps
// barbara.silva@ipam.org.br, dhemerson.costa@ipam.org.br and ana.souza@ipam.org.br

// Import mapbiomas color schema 
var vis = {
    min: 0,
    max: 62,
    palette:require('users/mapbiomas/modules:Palettes.js').get('classification8'),
    bands: 'classification_2020' 
};

// Set root directory
var root = 'projects/mapbiomas-workspace/COLECAO_DEV/COLECAO10_DEV/CERRADO/SENTINEL/C03-POST-CLASSIFICATION/';
var out = 'projects/mapbiomas-workspace/COLECAO_DEV/COLECAO10_DEV/CERRADO/SENTINEL/C03-POST-CLASSIFICATION/';

// Set metadata
var inputVersion = '10';
var outputVersion = '11';

// Define input file
var inputFile = 'CERRADO_C03_gapfill_v9_sandveg_v4_frequency_v7_temporal_v' + inputVersion;

// Load classification image
var classificationInput = ee.Image(root + inputFile);
Map.addLayer(classificationInput, vis, 'Input classification');

// Internal reference version used to constrain corrections
var col_5 = ee.Image(root + 'CERRADO_C03_gapfill_v5');
Map.addLayer(col_5, vis, 'col_5 classification');

// Initialize empty image to store corrected bands
var classificationOutput = ee.Image([]);

// --- --- --- RULE 01 — FALSE FOREST / SILVICULTURE REGENERATION
// Correct spurious forest/silviculture regrowth using historical patterns and a stable reference classification
ee.List.sequence({'start': 2017, 'end': 2024}).getInfo().forEach(function(year_i) {
  
  // Select the classification image for the corresponding year
  var imageYear = classificationInput.select('classification_' + year_i);
  var versionYear = col_5.select('classification_' + year_i);
  
  imageYear = imageYear.where(imageYear.eq(33).and(versionYear.eq(3)), 3);
  imageYear = imageYear.where(imageYear.eq(21).and(versionYear.eq(4)), 4);
  
  // Identify early or late silviculture persistence
  var y2017 = classificationInput.select('classification_2017').eq(21);
  var y2018 = classificationInput.select('classification_2018').eq(21);
  var y2023 = classificationInput.select('classification_2023').eq(21);
  var y2024 = classificationInput.select('classification_2024').eq(21);

  var earlySilvi = y2017.and(y2018);
  var lateSilvi = y2023.and(y2024);
  
  // Enforce silviculture class
  var silviCondition = earlySilvi.or(lateSilvi);

  var finalCondition = silviCondition.and(versionYear.eq(9));

  imageYear = imageYear.where(finalCondition, 21);
  
  // Add the reclassified band to the final filtered image
  classificationOutput = classificationOutput.addBands(imageYear.updateMask(imageYear.neq(0)));
});

Map.addLayer(classificationOutput, vis, '01: False forest regrowth');


// --- --- --- RULE 02 — FALSE WETLAND REGENERATION 
// Correct 11 → 21 → 11 temporal artifacts. Interpreted as false regeneration inside wetland areas
function correctWetland(currentYear, previousYear) {
  var mask = currentYear.neq(11).and(previousYear.eq(11));
  return currentYear.where(mask, previousYear);
}

var allYears = ee.List.sequence(2017, 2024).getInfo();

for (var i = 1; i < allYears.length - 1; i++) {

  var yearPrev = allYears[i - 1];
  var yearCurr = allYears[i];
  var yearNext = allYears[i + 1];

  var prevBand = classificationOutput.select('classification_' + yearPrev);
  var currBand = classificationOutput.select('classification_' + yearCurr);
  var nextBand = classificationOutput.select('classification_' + yearNext);
  
  // Identify false wetland interruption
  var condA = prevBand.eq(11)
      .and(currBand.eq(21))
      .and(nextBand.eq(11));

  var correctedA = currBand.where(condA, 12);

  classificationOutput = classificationOutput.addBands(
    correctedA.rename('classification_' + yearCurr),
    null,
    true
  );
}

// Check first and last year consistency
var firstBand = classificationOutput.select('classification_2017');
var lastBand = classificationOutput.select('classification_2024');

// Condition where grassland in first year becomes wetland in last year
var condB = firstBand.eq(12).and(lastBand.eq(11));

// Apply correction across all years if condition is met
if (condB) {
  allYears.forEach(function(y) {
    var bandY = classificationOutput.select('classification_' + y);
    var correctedB = bandY.where(condB, 11);
    classificationOutput = classificationOutput.addBands(
      correctedB.rename('classification_' + y),
      null,
      true
    );
  });
}

Map.addLayer(classificationOutput, vis, '02: False wetland regeneration');
print ('02: False wetland regeneration)', classificationOutput);


// --- --- --- RULE 02b — FALSE WETLAND REGENERATION 
// Prevent wetlands (11) from appearing without support from previous year
function correctWetland(currentYear, previousYear) {
  var mask = currentYear.eq(11).and(previousYear.neq(11));
  return currentYear.where(mask, previousYear);
}

var allYears = ee.List.sequence(2017, 2024).getInfo();

for (var i = 1; i < allYears.length; i++) {
  var currentYear = allYears[i];
  var previousYear = allYears[i - 1];

  var currentBand = classificationOutput.select('classification_' + currentYear);
  var previousBand = classificationOutput.select('classification_' + previousYear);

  var correctedBand = correctWetland(currentBand, previousBand);

  classificationOutput = classificationOutput.addBands(
    correctedBand.rename('classification_' + currentYear), null, true
  );
}

Map.addLayer(classificationOutput, vis, '02b: False wetland regeneration');
print ('02b: False wetland regeneration)', classificationOutput);


// --- --- RULE 03 — ABRUPT RESTINGA APPEARANCE
// Prevent Sandbank Vegetation (Restinga Herbácea, 50) from appearing without temporal continuity
function correctRestinga(currentYear, previousYear) {
  return currentYear.where(currentYear.eq(50).and(previousYear.neq(50)), previousYear);
}

// Apply  correction throughout time series
for (var i = 1; i < allYears.length; i++) {
  var current = allYears[i];
  var previous = allYears[i - 1];

  var currentBand = classificationOutput.select('classification_' + current);
  var previousBand = classificationOutput.select('classification_' + previous);

  var correctedBand = correctRestinga(currentBand, previousBand);
  classificationOutput = classificationOutput.addBands(correctedBand.rename('classification_' + current), null, true);
}

Map.addLayer(classificationOutput, vis, '03: Sandbank veg. adjustment');
print('Sandbank veg. adjustment', classificationOutput);


// --- --- RULE 04 — ABRUPT SAVANNA APPEARANCE
// Define function to prevent abrupt Savanna (4) replacing farming areas (21)
function correctSavana(currentYear, previousYear) {
  return currentYear.where(currentYear.eq(4).and(previousYear.eq(21)), previousYear);
}

// Apply savanna correction throughout time series
for (var i = 1; i < allYears.length; i++) {
  var current = allYears[i];
  var previous = allYears[i - 1];

  var currentBand = classificationOutput.select('classification_' + current);
  var previousBand = classificationOutput.select('classification_' + previous);

  var correctedBand = correctSavana(currentBand, previousBand);
  classificationOutput = classificationOutput.addBands(correctedBand.rename('classification_' + current), null, true);
}

Map.addLayer(classificationOutput, vis, '04: Savanna adjustment');
print('Restinga adjustment', classificationOutput);

// --- --- RULE 05 — ABRUPT GRASSLAND APPEARANCE
// Define function to prevent abrupt Grassland appearance
function correctGrassLand(currentYear, previousYear) {
  return currentYear.where(currentYear.eq(12).and(previousYear.neq(12)), previousYear);
}

// Apply grassland correction across the time series
for (var i = 1; i < allYears.length; i++) {
  var current = allYears[i];
  var previous = allYears[i - 1];

  var currentBand = classificationOutput.select('classification_' + current);
  var previousBand = classificationOutput.select('classification_' + previous);

  var correctedBand = correctGrassLand(currentBand, previousBand);
  classificationOutput = classificationOutput.addBands(correctedBand.rename('classification_' + current), null, true);
}

Map.addLayer(classificationOutput, vis, '05: Grassland adjustment');
print('Restinga adjustment', classificationOutput);


print ('Output classification', classificationOutput);

// Export as GEE asset
Export.image.toAsset({
    'image': classificationOutput,
    'description': inputFile + '_falseReg_v' + outputVersion,
    'assetId': out +  inputFile + '_falseReg_v' + outputVersion,
    'pyramidingPolicy': {
        '.default': 'mode'
    },
    'region':classificationOutput.geometry(),
    'scale': 10,
    'maxPixels': 1e13
});

