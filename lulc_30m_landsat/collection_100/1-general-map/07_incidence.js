// -- -- -- -- 07_incidence
// Apply a temporal consistency filter to remove spurious land cover transitions
// using the number of transitions, connectivity analysis, and mode-based correction.

// Author: barbara.silva@ipam.org.br

// Import MapBiomas color palette
var vis = {
    min: 0,
    max: 62,
    palette:require('users/mapbiomas/modules:Palettes.js').get('classification8'),
    bands: 'classification_2023'
};

// Set root directory 
var root = 'projects/mapbiomas-workspace/COLECAO_DEV/COLECAO10_DEV/CERRADO/LANDSAT/C10-POST-CLASSIFICATION/';
var out = 'projects/mapbiomas-workspace/COLECAO_DEV/COLECAO10_DEV/CERRADO/LANDSAT/C10-POST-CLASSIFICATION/';

// Define input/output metadata
var inputVersion = '11';
var outputVersion = '4';
var thresholdEvents = 14;

// Define input file
var inputFile = 'CERRADO_C10_gapfill_v' + inputVersion;

// Load classification image
var classificationInput = ee.Image(root + inputFile);
print('Input classification', classificationInput);
Map.addLayer(classificationInput, vis, 'Input classification');

// Remap original MapBiomas classes into level 2 aggregation scheme
var originalClasses = [
    3, 4,    // Forest, Savanna
    11, 12,  // Wetlands, Grasslands
    15,      // Pasture
    18,      // Agriculture
    25,      // Non-vegetated
    33,      // Water
    27       // Non-observed
];

var aggregatedClasses = [
    2, 2,   // Forest, Savanna
    2, 2,   // Wetlands, Grasslands
    1,      // Pasture
    1,      // Agriculture
    1,      // Non-vegetated
    7,      // Water
    7       // Non-observed
];

var classificationAggregated = ee.Image([]);

// Remove Non-vegetated class from incidents filter
var classification_remap = classificationInput.updateMask(classificationInput.neq(25));

// Process classification per year
ee.List.sequence(1985, 2024).getInfo()
    .forEach(function(year) {
        // Get year [i]
        var classificationYear = classification_remap.select(['classification_' + year])
            // Remap classes
            .remap(originalClasses, aggregatedClasses)
            .rename('classification_' + year);
            
        // Insert into aggregated classification
        classificationAggregated = classificationAggregated.addBands(classificationYear);
    });

classificationAggregated = classificationAggregated.updateMask(classificationAggregated.neq(0));

// Compute temporal metrics: number of classes and changes
var numChanges = classificationAggregated.reduce(ee.Reducer.countRuns()).subtract(1).rename('number_of_changes');
Map.addLayer(numChanges, {
  min: 0,
  max: 15,
  palette: ['#C8C8C8', '#FED266', '#FBA713', '#cb701b', '#a95512', '#662000', '#cb181d']
}, 'Number of changes', false);

// Get the count of connections
var connectedNumChanges = numChanges.connectedPixelCount({
    'maxSize': 100,
    'eightConnected': true
});

// Compute the mode of the pixel values in the time series
var modeImage = classification_remap.reduce(ee.Reducer.mode());

// Get border pixels (high geolocation RMSE) to be masked by the mode (7 pixels = 0,6 ha)
// The main objective is to identify unstable pixels in a patch of vegetation
var borderMask = connectedNumChanges.lte(7).and(numChanges.gt(10));
borderMask = borderMask.updateMask(borderMask.eq(1));

// Get borders to rectify
// Here, the main objective is to correct temporal instability in large areas of vegetation
var rectBorder = modeImage.updateMask(borderMask);
var rectAll = modeImage.updateMask(connectedNumChanges.gt(7).and(numChanges.gte(thresholdEvents)));

// Blend masks
var incidentsMask = rectBorder.blend(rectAll).toByte();

// Apply the rectification
var correctedClassification = classificationInput.blend(incidentsMask);

Map.addLayer(correctedClassification, vis, 'Corrected classification');
print('Output classification', correctedClassification);

// Export as GEE asset
Export.image.toAsset({
    'image': correctedClassification,
    'description': inputFile + '_incidence_v' + outputVersion,
    'assetId': out +  inputFile + '_incidence_v' + outputVersion,
    'pyramidingPolicy': {
        '.default': 'mode'
    },
    'region': correctedClassification.geometry(),
    'scale': 30,
    'maxPixels': 1e13
});
