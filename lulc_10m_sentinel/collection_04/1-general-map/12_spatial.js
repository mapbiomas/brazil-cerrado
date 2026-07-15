// -- -- -- -- 12_spatial
// post-processing filter: spatial filter to define a minimum area
// barbara.silva@ipam.org.br, dhemerson.costa@ipam.org.br and ana.souza@ipam.org.br

// Import mapbiomas color schema 
var vis = {
    min: 0,
    max: 62,
    palette:require('users/mapbiomas/modules:Palettes.js').get('classification8'),
    bands: 'classification_2017'
};

// Set root directory 
var root = 'projects/mapbiomas-workspace/COLECAO_DEV/COLECAO10_DEV/CERRADO/SENTINEL/C03-POST-CLASSIFICATION/';
var out = 'projects/mapbiomas-workspace/COLECAO_DEV/COLECAO10_DEV/CERRADO/SENTINEL/C03-POST-CLASSIFICATION/';

// Set metadata
var inputVersion = '6';
var outputVersion = '3';

// Define input file
var inputFile = 'CERRADO_C03_gapfill_v9_sandveg_v4_frequency_v7_temporal_v10_falseReg_v11_geom_v'+inputVersion;

// Load classification
var classificationInput = ee.Image(root + inputFile);
print('Input classification', classificationInput);
Map.addLayer(classificationInput, vis, 'Input classification');


// --- ---  Apply 1st sequence of the spatial filter
// Create an empty container
var filtered = ee.Image([]);

// Set filter size
var filter_size = 60;

// Iterate over the years
ee.List.sequence({'start': 2017, 'end': 2024}).getInfo()
      .forEach(function(year_i) {
        // Compute the focal model
        var focal_mode = classificationInput.select(['classification_' + year_i])
                .unmask(0)
                .focal_mode({'radius': 1, 'kernelType': 'square', 'units': 'pixels'});
 
        // Compute the number of connections
        var connections = classificationInput.select(['classification_' + year_i])
                .unmask(0)
                .connectedPixelCount({'maxSize': 100, 'eightConnected': false});
        
        // Get the focal model when the number of connections of same class is lower than parameter
        var to_mask = focal_mode.updateMask(connections.lte(filter_size));

        // Apply filter
        var classification_i = classificationInput.select(['classification_' + year_i])
                .blend(to_mask)
                .reproject('EPSG:4326', null, 10);

        // Stack into container
        filtered = filtered.addBands(classification_i.updateMask(classification_i.neq(0)));
        }
      );

// Plot 1st sequence of the spatial filter
Map.addLayer(filtered, vis, 'filtered - round 1');


// --- ---  Apply 2nd sequence of the spatial filter
// Set container 
var container = ee.Image([]);

// Iterate over the years
ee.List.sequence({'start': 2017, 'end': 2024}).getInfo()
      .forEach(function(year_i) {
        // Compute the focal model
        var focal_mode = filtered.select(['classification_' + year_i])
                .unmask(0)
                .focal_mode({'radius': 1, 'kernelType': 'square', 'units': 'pixels'});
 
        // Compute the number of connections
        var connections = filtered.select(['classification_' + year_i])
                .unmask(0)
                .connectedPixelCount({'maxSize': 100, 'eightConnected': false});
        
        //Get the focal model when the number of connections of same class is lower than parameter
        var to_mask = focal_mode.updateMask(connections.lte(filter_size));

        // Apply filter
        var classification_i = filtered.select(['classification_' + year_i])
                .blend(to_mask)
                .reproject('EPSG:4326', null, 10);

        // Stack into container
        container = container.addBands(classification_i.updateMask(classification_i.neq(0)));
        }
      );

// Plot 2nd sequence of the spatial filter
Map.addLayer(container, vis, 'filtered 2 - round 2');

print('Output classification', container);

// Export as GEE asset
Export.image.toAsset({
    'image': container,
    'description': (inputFile + '_spatial_v' + outputVersion).trim(),
    'assetId': (out + inputFile + '_spatial_v' + outputVersion).trim(),
    'pyramidingPolicy': {
        '.default': 'mode'
    },
    'region': container.geometry(),
    'scale': 10,
    'maxPixels': 1e13
});

