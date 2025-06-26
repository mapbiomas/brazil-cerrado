// --- --- --- 09_frequency
// Post-processing filter to stabilize native vegetation classes that remained in place for at least 90% of the time series
// Computes per-class frequency over the time series and reassigns stable native vegetation based on thresholds

// Author: barbara.silva@ipam.org.br

// Import MapBiomas color palette
var vis = {
    min: 0,
    max: 62,
    palette:require('users/mapbiomas/modules:Palettes.js').get('classification8'),
    bands: "classification_1985"
};

// Set root directory 
var root = 'projects/mapbiomas-workspace/COLECAO_DEV/COLECAO10_DEV/CERRADO/LANDSAT/C10-POST-CLASSIFICATION/';
var out = 'projects/mapbiomas-workspace/COLECAO_DEV/COLECAO10_DEV/CERRADO/LANDSAT/C10-POST-CLASSIFICATION/';

// Define input/output metadata
var inputVersion = '3';
var outputVersion = '7';

// Define input file
var inputFile = 'CERRADO_C10_gapfill_v11_incidence_v4_sandVeg_v'+inputVersion;

// Load classification image
var classificationInput = ee.Image(root + inputFile);
print('Input classification', classificationInput);
Map.addLayer(classificationInput, vis, 'Input classification');

// Frequency filter function
var filterFreq = function(image) {
 var exp = '100*((b(0)+b(1)+b(2)+b(3)+b(4)+b(5)+b(6)+b(7)+b(8)+b(9)+b(10)' +
                '+b(11)+b(12)+b(13)+b(14)+b(15)+b(16)+b(17)+b(18)+b(19)+b(20)' +
                '+b(21)+b(22)+b(23)+b(24)+b(25)+b(26)+b(27)+b(28)+b(29)+b(30)' +
                '+b(31)+b(32)+b(33)+b(34)+b(35)+b(36)+b(37)+b(38)+b(39))/40)';

  // Compute class frequency
  var forest = image.eq(3).expression(exp);
  var savanna = image.eq(4).expression(exp);
  var wetland = image.eq(11).expression(exp);
  var grassland = image.eq(12).expression(exp);
  var sandveg = image.eq(50).expression(exp);

   // Identify pixels that were native vegetation at least 90% of the time
  var stable_native = ee.Image(0).where(forest
                                 .add(savanna)
                                 .add(wetland)
                                 .add(grassland)
                                 .add(sandveg)
                                 .gte(90), 1);

  Map.addLayer (stable_native, {}, "stable_native", false);

  // Stabilize native vegetation classes based on per-class frequency thresholds
  var filtered = ee.Image(0)
    .where(stable_native.eq(1).and(forest.gte(70)), 3)        // Forest ≥ 28 years
    .where(stable_native.eq(1).and(wetland.gte(60)), 11)      // Wetland ≥ 24 years
    .where(stable_native.eq(1).and(savanna.gt(40)), 4)        // Savanna > 16 years
    .where(stable_native.eq(1).and(grassland.gt(50)), 12)     // Grassland > 20 years
    .where(stable_native.eq(1).and(sandveg.gte(60)), 50);     // Sandbank vegetation ≥ 24 years

  // Mask pixels that will be updated
  filtered = filtered.updateMask(filtered.neq(0));
  
  return image.where(filtered, filtered);
};

// Apply frequency filter to classification
var classification_filtered = filterFreq(classificationInput);

Map.addLayer(classification_filtered, vis, 'Output classification');
print('Output classification', classification_filtered);

// Export as GEE asset
Export.image.toAsset({
    'image': classification_filtered,
    'description': inputFile + '_freq_v' + outputVersion,
    'assetId': out +  inputFile + '_freq_v' + outputVersion,
    'pyramidingPolicy': {
        '.default': 'mode'
    },
    'region': classification_filtered.geometry(),
    'scale': 30,
    'maxPixels': 1e13
});
