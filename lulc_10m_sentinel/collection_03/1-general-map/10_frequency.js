// -- -- -- -- 08_frequency
// post-processing filter: stabilize areas of native vegetation that have remained for at least 90% of the data time series
// barbara.silva@ipam.org.br, dhemerson.costa@ipam.org.br and ana.souza@ipam.org.br

// Import mapbiomas color schema 
var vis = {
    min: 0,
    max: 62,
    palette:require('users/mapbiomas/modules:Palettes.js').get('classification8'),
    bands: 'classification_2024'
};

// Set root directory 
var root = 'projects/mapbiomas-workspace/COLECAO_DEV/COLECAO10_DEV/CERRADO/SENTINEL/C03-POST-CLASSIFICATION/';
var out = 'projects/mapbiomas-workspace/COLECAO_DEV/COLECAO10_DEV/CERRADO/SENTINEL/C03-POST-CLASSIFICATION/';

// Set metadata
var inputVersion = '4';
var outputVersion = '7';

// Define input file
var inputFile = 'CERRADO_C03_gapfill_v9_sandveg_v'+inputVersion;

// Load classification
var classification = ee.Image(root + inputFile);
print('Input classification', classification);
Map.addLayer(classification, vis, 'Input classification');

// Define the function to calculate the frequencies 
var filterFreq = function(image) {
  // Expression to get frequency
  var exp = '100*((b(0)+b(1)+b(2)+b(3)+b(4)+b(5)+b(6)+b(7))/8)';

  // Get per class frequency 
  var forest = image.eq(3).expression(exp);
  var savanna = image.eq(4).expression(exp);
  var wetland = image.eq(11).expression(exp);
  var grassland = image.eq(12).expression(exp);
  var sandveg = image.eq(50).expression(exp);

  // Select pixels that were native vegetation in at least 85% of the time series
  var stable_native = ee.Image(0).where(forest
                                   .add(savanna)
                                   .add(wetland)
                                   .add(grassland)
                                   .add(sandveg)
                                   .gte(90), 1);
                                   
  // Stabilize native class when:
  var filtered = ee.Image(0).where(stable_native.eq(1).and(forest.gte(70)), 3)     // needs to occur at least 6 years
                            .where(stable_native.eq(1).and(wetland.gte(95)), 11)   // needs to occur at least 8 years
                            .where(stable_native.eq(1).and(savanna.gt(60)), 4)     // needs to occur at least 5 years
                            .where(stable_native.eq(1).and(grassland.gt(40)), 12)  // needs to occur at least 3 years
                            .where(stable_native.eq(1).and(sandveg.gt(40)), 50);   // needs to occur at least 3 years

  // Get only pixels to be filtered
  filtered = filtered.updateMask(filtered.neq(0));
  
  return image.where(filtered, filtered);
};

// Apply function  
var classification_filtered = filterFreq(classification);

Map.addLayer(classification_filtered, vis, 'filtered');

print('Output classification', classification_filtered);

// Export as GEE asset
Export.image.toAsset({
    'image': classification_filtered,
    'description': inputFile + '_frequency_v' + outputVersion,
    'assetId': out +  inputFile + '_frequency_v' + outputVersion,
    'pyramidingPolicy': {
        '.default': 'mode'
    },
    'region':classification_filtered.geometry(),
    'scale': 10,
    'maxPixels': 1e13
});
