// -- -- -- -- 11_noFalseRegrowth
// This script applies post-classification filters to remove false regrowth of native vegetation in silviculture areas 
// and wetlands. It also enforces temporal stability for specific land cover classes (non-vegetated and sandbank vegetation) 
// in the Cerrado biome from 1985 to 2024.

// Author: barbara.silva@ipam.org.br

// Import MapBiomas color palette
var vis = {
    min: 0,
    max: 62,
    palette:require('users/mapbiomas/modules:Palettes.js').get('classification8'),
    bands: 'classification_1985'
};

// Set root directory 
var root = 'projects/mapbiomas-workspace/COLECAO_DEV/COLECAO10_DEV/CERRADO/LANDSAT/C10-POST-CLASSIFICATION/';
var out = 'projects/mapbiomas-workspace/COLECAO_DEV/COLECAO10_DEV/CERRADO/LANDSAT/C10-POST-CLASSIFICATION/';

// Define input/output metadata
var inputVersion = '16';
var outputVersion = '29';

// Define input file
var inputFile = 'CERRADO_C10_gapfill_v11_incidence_v4_sandVeg_v3_freq_v7_temp_v'+inputVersion;

// Load classification image
var classificationInput = ee.Image(root + inputFile);
print('Input classification', classificationInput);
Map.addLayer(classificationInput, vis, 'Input classification');

// ----------------------------------------------------
// Step 1: Prevent native forest (class 3) regrowth in stable silviculture (class 21) areas
// ----------------------------------------------------

// Set number of years to consider for anthropic stability (7 years)
var x = 7;

// Create padding bands to ensure time window availability
var exedent_bands = classificationInput.slice(0, (x - 1)).multiply(0)
  .rename(['b1', 'b2', 'b3', 'b4', 'b5', 'b6']);
  
// Iterate over bands to replace forest regrowth with class 21 when condition is met
var processedClassification = classificationInput.bandNames().slice(1).iterate(function(current, previous) {
    current = ee.String(current);
    previous = ee.Image(previous);
    
    // Select the current band from the classification image
    var img = classificationInput.select(current); 
    
    // Check if the last x years have been classified as anthropic class (21)
    var mosaic_per_Xyears = previous.slice(-1 * x).eq(21).reduce('sum').gte(x);
    
    // Replace native forest regrowth (class 3) with anthropic (class 21) where the condition is met
    var new_img = img.where(mosaic_per_Xyears.and(img.eq(3)), 21);

    // Add the new image as a band to the previous result
    return ee.Image(previous).addBands(new_img);
  }, exedent_bands.addBands(classificationInput.select(0)));


processedClassification = ee.Image(processedClassification).slice(x - 1);

var finalClassification = processedClassification;

Map.addLayer(finalClassification, vis, '01: False forest regeneration');
print ('01: False forest regeneration', finalClassification);

// ----------------------------------------------------
// Step 2: Correct false wetland (class 11) regeneration in early years (1985–1986)
// ----------------------------------------------------

// Select bands for the years 1985, 1986, and 1987
var year1985 = finalClassification.select('classification_1985');
var year1986 = finalClassification.select('classification_1986');
var year1987 = finalClassification.select('classification_1987');

var wetlands = 11;

// Identify and correct inconsistencies based on 1987
var wetlands1987 = year1987.eq(wetlands);

// Identify inconsistency in 1985 and correct using 1987
var wasWetlands1985_not1987 = year1985.eq(wetlands).and(year1987.neq(wetlands));
var wasNotWetlands1985_but1987 = year1985.neq(wetlands).and(year1987.eq(wetlands));

var corrected1985 = year1985.where(wasWetlands1985_not1987.or(wasNotWetlands1985_but1987), year1987);

// Identify inconsistency in 1986 and correct using 1987
var wasWetlands1986_not1987 = year1986.eq(wetlands).and(year1987.neq(wetlands));
var wasNotWetlands1986_but1987 = year1986.neq(wetlands).and(year1987.eq(wetlands));

var corrected1986 = year1986.where(wasWetlands1986_not1987.or(wasNotWetlands1986_but1987), year1987);

finalClassification = finalClassification
                   .addBands(corrected1985.rename('classification_1985'), null, true)
                   .addBands(corrected1986.rename('classification_1986'), null, true);

Map.addLayer(finalClassification, vis, '02: False wetland regeneration');
print('02: False wetland regeneration', finalClassification);

// --- --- Additional rule: prevent abrupt wetland appearance using previous year as reference

// Iterate through the time series and apply wetland correction
function correctWetland(currentYear, previousYear) {
  var mask = currentYear.eq(11).and(previousYear.neq(11));
  return currentYear.where(mask, previousYear);
}

var allYears = ee.List.sequence(1985, 2024).getInfo();

for (var i = 1; i < allYears.length; i++) {
  var currentYear = allYears[i];
  var previousYear = allYears[i - 1];

  var currentBand = finalClassification.select('classification_' + currentYear);
  var previousBand = finalClassification.select('classification_' + previousYear);

  var correctedBand = correctWetland(currentBand, previousBand);

  finalClassification = finalClassification.addBands(
    correctedBand.rename('classification_' + currentYear), null, true
  );
}

Map.addLayer(finalClassification, vis, '02b: False wetland regeneration');
print ('02b: False wetland regeneration)', finalClassification);

// ----------------------------------------------------
// Step 3: Enforce non-vegetated (class 25) stability if it remains ≥15 years and no interference from class 12 or 33
// ----------------------------------------------------

// Correct initial years (1985–1986) based on 1987 for class 25
var corrected1985_25 = finalClassification.select('classification_1985').where(
  finalClassification.select('classification_1985').eq(25).and(finalClassification.select('classification_1987').neq(25))
    .or(finalClassification.select('classification_1985').neq(25).and(finalClassification.select('classification_1987').eq(25))),
  finalClassification.select('classification_1987')
);

var corrected1986_25 = finalClassification.select('classification_1986').where(
  finalClassification.select('classification_1986').eq(25).and(finalClassification.select('classification_1987').neq(25))
    .or(finalClassification.select('classification_1986').neq(25).and(finalClassification.select('classification_1987').eq(25))),
  finalClassification.select('classification_1987')
);

var finalClassification = finalClassification
  .addBands(corrected1985_25.rename('classification_1985'), null, true)
  .addBands(corrected1986_25.rename('classification_1986'), null, true);

// Count years classified as 25 and mask if classes 12 or 33 are present
var anos = ee.List.sequence(1985, 2024).getInfo();
var masksClass25 = anos.map(function(ano) {
  return finalClassification.select('classification_' + ano).eq(25).rename('class25_' + ano);
});
var stackMasks25 = ee.ImageCollection.fromImages(masksClass25).toBands();

var stackMasks12 = ee.ImageCollection.fromImages(anos.map(function(ano) {
  return finalClassification.select('classification_' + ano).eq(12).rename('class12_' + ano);
})).toBands();

var stackMasks33 = ee.ImageCollection.fromImages(anos.map(function(ano) {
  return finalClassification.select('classification_' + ano).eq(33).rename('class33_' + ano);
})).toBands();

// Detect presence of exception classes (12 or 33)
var hasClass12 = stackMasks12.reduce(ee.Reducer.max()).eq(1);
var hasClass33 = stackMasks33.reduce(ee.Reducer.max()).eq(1);
var hasExceptionClass = hasClass12.or(hasClass33);

// Count number of years classified as 25
var countClass25 = stackMasks25.reduce(ee.Reducer.sum());

// Gilbués-PI region
var mask = ee.Image(1).clip(ee.Geometry.Polygon([
  [-45.65, -10.58],
  [-44.81, -10.58],
  [-44.81, -9.69],
  [-45.65, -9.69]
]));

// Create stability mask for class 25 (≥15 years and no class 12 or 33)
var stable25Mask = countClass25.gte(15).and(hasExceptionClass.not()).and(mask.eq(1));

// Apply class 25 where stability condition is satisfied
var forcedClass25 = ee.ImageCollection(anos.map(function(ano) {
  var band = finalClassification.select('classification_' + ano);
  return band.where(stable25Mask, 25).rename('classification_' + ano);
})).toBands().rename(anos.map(function(ano) {
  return ee.String('classification_').cat(ee.Number(ano));
}));

finalClassification = forcedClass25;

Map.addLayer(finalClassification, vis, '03: Non-vegetated stability');
print('03: Non-vegetated stability', finalClassification);

// ----------------------------------------------------
// Step 4: Sandbank Vegetation (class 50) correction based on previous year
// ----------------------------------------------------

// Function to correct class 50 using previous year as reference
function correctRestinga(currentYear, previousYear) {
  return currentYear.where(currentYear.eq(50).and(previousYear.neq(50)), previousYear);
}

// Apply restinga correction throughout time series
for (var i = 1; i < allYears.length; i++) {
  var current = allYears[i];
  var previous = allYears[i - 1];

  var currentBand = finalClassification.select('classification_' + current);
  var previousBand = finalClassification.select('classification_' + previous);

  var correctedBand = correctRestinga(currentBand, previousBand);
  finalClassification = finalClassification.addBands(correctedBand.rename('classification_' + current), null, true);
}

Map.addLayer(finalClassification, vis, '04: Restinga adjustment');
print('Restinga adjustment', finalClassification);


// Export as GEE asset
Export.image.toAsset({
    'image': finalClassification,
    'description': inputFile+ '_falseReg_v' + outputVersion,
    'assetId': out + inputFile + '_falseReg_v' + outputVersion,
    'pyramidingPolicy': {
        '.default': 'mode'
    },
    'region': classificationInput.geometry(),
    'scale': 30,
    'maxPixels': 1e13
});

