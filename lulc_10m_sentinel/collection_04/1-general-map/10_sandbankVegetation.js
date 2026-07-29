// -- -- -- -- 10) Sandbank Vegetation Filter
// This script applies a post-classification correction to identify 
// herbaceous sandbank vegetation (Restinga herbácea) using a GTB classifier. 
// Pixels classified as savanna, grassland or wetland classes in the original 
// LULC classification are reassigned to class 50 (Herbaceous sandbank) 
// where the GTB model predicts the class occurrence.


// Define visualization parameters
var vis = {
  min: 0,
  max: 75,
  palette: require('users/mapbiomas/modules:Palettes.js').get('brazil'),
  bands: 'classification_2020'
};

// Define a binary visualization parameter set for diagnostic masks
var maskVis = { min: 0, max: 1, palette: ['ffffff', 'ff00ff'] };

// Define the input version
var inputVersion = '2';

// Define the output version
var outputVersion = '3';

// Define the base directory
var root = 'projects/ee-ipam/assets/MAPBIOMAS/LULC/CERRADO_DEV/COL_11/SENTINEL/C04-POST-CLASSIFICATION/';
var out = 'projects/ee-ipam/assets/MAPBIOMAS/LULC/CERRADO_DEV/COL_11/SENTINEL/C04-POST-CLASSIFICATION/';

// Construct the base name of the input file
var inputFile = 'CERRADO_C04_gapfill_v3_spt_v1_tp_v3_tra_v' + inputVersion;

// Load the classification multi-band image
var classificationInput = ee.Image(root + inputFile);
print('Input classification', classificationInput);
Map.addLayer(classificationInput, vis, 'Input classification', false);

// Set projection
var referenceProjection = classificationInput.projection()

// Set the year list of the processing time-series
var years = ee.List.sequence(2017, 2025);

// Load the coastal sandy deposits vector dataset from CPRM/SGB (Brazilian Geological Service)
var soilVector = ee.FeatureCollection('projects/barbaracosta-ipam/assets/base/CPRM_coastal_deposits_v4');

// Paint the vector boundaries into a binary 10m raster matching the classification's projection and clip it
var soilMask = ee.Image(0).byte().paint({ featureCollection: soilVector, color: 1 })
                  .rename('soil_mask')
                  .reproject({ crs: referenceProjection, scale: 10 })
                  .clip(classificationInput.geometry()).unmask(0).byte();

// HAND (Height Above Nearest Drainage)
var hand = ee.Image('MERIT/Hydro/v1_0_1').select('hnd').reproject({crs: 'EPSG:4674', scale: 10});

// Canopy height layer
var canopy = ee.Image('users/nlang/ETH_GlobalCanopyHeight_2020_10m_v1');

// FABDEM elevation model
var fabdemCol = ee.ImageCollection("projects/sat-io/open-datasets/FABDEM");
var proj = fabdemCol.first().projection();
var dem = fabdemCol.mosaic().setDefaultProjection(proj);

// Multi-year Landsat 8 median mosaic
var mosaicAsset = 'projects/nexgenmap/MapBiomas2/SENTINEL/mosaics-3';
var referenceMosaic = ee.ImageCollection(mosaicAsset)
    .filter(ee.Filter.inList('biome', ['CERRADO']))
    .filter(ee.Filter.inList('satellite', ['s2_harmonized']))
    .filter(ee.Filter.eq('year', 2024))
    .median();

// Spectral predictor bands
var spectralBands = ['red_edge_1_median', 'nir_median', 'swir1_median', 
                     'gcvi_median', 'gcvi_median_wet',
                     'evi2_median_wet', 'evi2_median_dry',
                     'ndwi_amp', 'wefi_median_wet', 'sefi_median_dry'];

// Build predictor image
var predictorImage = referenceMosaic.select(spectralBands)
                                    .addBands(hand.rename('hand'))
                                    .addBands(soilMask.rename('soil_mask'))
                                    .addBands(canopy)
                                    .addBands(dem);

// Predictor band names
var trainingBands = predictorImage.bandNames();
print ('trainingBands', trainingBands);

// Input training polygons
// Herbaceous sandbank polygons must contain class = 50
// Non-Herbaceous sandbank polygons must contain class = 0
var sandbankPolygons = ee.FeatureCollection ("projects/ee-ipam-cerrado/assets/Collection_04/sample/manual/collected_samples_herbaceous_sandbank"); 
var nonSandbankPolygons = ee.FeatureCollection ("projects/ee-ipam-cerrado/assets/Collection_04/sample/manual/collected_samples_no-herbaceous_sandbank");

// Number of random points per class
var nPoints = 1500;

// Generate random points for sandbank vegetation class
var sandbankPts = ee.FeatureCollection.randomPoints({
  region: sandbankPolygons.geometry(),
  points: nPoints,
  seed: 1,
  maxError: 30
}).map(function(f) {
  return f.set('class', 50);
});

// Generate random points for non-sandbank vegetation class
var nonSandbankPts = ee.FeatureCollection.randomPoints({
  region: nonSandbankPolygons.geometry(),
  points: nPoints,
  seed: 2,
  maxError: 30
}).map(function(f) {
  return f.set('class', 0);
});

// Merge all training points
var samplePoints = sandbankPts.merge(nonSandbankPts);

// Extract predictor values at sample locations
var trainingPoints = predictorImage.sampleRegions({
  collection: samplePoints,
  properties: ['class'],
  scale: 10,
  geometries: true,
  tileScale: 4
});

// Remove samples with null values
trainingPoints = trainingPoints.filter(ee.Filter.notNull(trainingBands));

// Visualize training samples
Map.addLayer(samplePoints.filter(ee.Filter.eq('class', 50)), {color: 'cyan'}, 'Sandbank vegetation', false);
Map.addLayer(samplePoints.filter(ee.Filter.eq('class', 0)), {color: 'red'}, 'Non-Sandbank vegetation', false);

// Train Gradient Tree Boost classifier
var classifier = ee.Classifier.smileGradientTreeBoost(50).train({
  features: trainingPoints,
  classProperty: 'class',
  inputProperties: trainingBands
});

// Apply classification
var predictedSandbank = predictorImage.classify(classifier);

// Visualize predicted mask
Map.addLayer(predictedSandbank.mask(predictedSandbank.eq(50)), {palette: ['magenta']}, 'GTB Mask', false);

// Restrict predictions to coastal sandy deposits
var sandbankMask = predictedSandbank.eq(50).and(soilMask.eq(1));

// Apply correction to the full time series
var listSandbank = years.map(function(year) {
  var bandName = ee.String('classification_').cat(ee.Number(year).format('%d'));
  var currentImg = classificationInput.select(bandName);
  
  // Eligible classes for conversion to herbaceous sandbank
  var eligibleClasses = currentImg.eq(4)
                        .or(currentImg.eq(11))
                        .or(currentImg.eq(12));
  
  // Apply Random Forest Sandbank mask
  var applySandbank = sandbankMask.and(eligibleClasses);
  
  // Replace eligible pixels with class 50
  var corrected = currentImg.where(applySandbank, 50);
  
  return corrected.rename(bandName);
});

// Reconstruct the array of corrected single-band images back into a unified multi-band image
var finalClassification = ee.ImageCollection.fromImages(listSandbank).toBands()
                                            .rename(classificationInput.bandNames())
                                            .set({
                                                'filter': '10_sandbank_vegetation',
                                                'input_asset': inputFile,
                                                'input_version': inputVersion,
                                                'output_version': outputVersion,
                                              });

// Print the resulting final filtered classification structure 
print('Final classification', finalClassification);

// Render the finalized classification map to the display
Map.addLayer(finalClassification, vis, 'Final classification');

// Export as GEE asset
Export.image.toAsset({
  image: finalClassification,
  description: inputFile + '_snv_v' + outputVersion,
  assetId: out + inputFile + '_snv_v' + outputVersion,
  pyramidingPolicy: {
    '.default': 'mode'
  },
  region: classificationInput.geometry(),
  scale: 10,
  maxPixels: 1e13
});
