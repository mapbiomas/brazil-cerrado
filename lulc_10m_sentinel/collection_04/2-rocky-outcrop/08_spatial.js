// -- -- -- -- 08_spatial
// post-processing filter: eliminate isolated or edge transition pixels, minimum area of 20 pixels
// barbara.silva@ipam.org.br 

// Import mapbiomas color ramp
var vis = {
      min:0,
      max:62,
      palette: require('users/mapbiomas/modules:Palettes.js').get('classification8'),
      bands: 'classification_2023'
};

// Set metadata
var input_version = '2';
var output_version = '6';

// Set root directory
var root = 'projects/ee-barbarasilvaipam/assets/collection-03_rocky-outcrop/post-classification/';
var dirout = 'projects/ee-barbarasilvaipam/assets/collection-03_rocky-outcrop/post-classification/';

// Load input classification
var inputFile = 'CERRADO_C03_rocky_gapfill_frequency_v' + input_version;
var classification = ee.Image(root + inputFile);

print ("input", classification);
Map.addLayer(classification, vis, 'input');

// Create an empty container
var filtered = ee.Image([]);

// Set filter size
var filter_size = 20;

// Apply first sequence of the spatial filter
ee.List.sequence({'start': 2017, 'end': 2024}).getInfo()
      .forEach(function(year_i) {
        // Compute the focal model
        var focal_mode = classification.select(['classification_' + year_i])
                .unmask(0)
                .focal_mode({'radius': 10, 'kernelType': 'square', 'units': 'pixels'});
 
        // Compute the number of connections
        var connections = classification.select(['classification_' + year_i])
                .unmask(0)
                .connectedPixelCount({'maxSize': 120, 'eightConnected': false});
        
        // Get the focal model when the number of connections of same class is lower than parameter
        var to_mask = focal_mode.updateMask(connections.lte(filter_size));

        // Apply filter
        var classification_i = classification.select(['classification_' + year_i])
                .blend(to_mask)
                .reproject('EPSG:4326', null, 10);

         // Stack into container
        filtered = filtered.addBands(classification_i.updateMask(classification_i.neq(0)));
        }
      );

// Plot first sequence of the spatial filter
Map.addLayer(filtered, vis, 'Filtered Classification');

print('Output classification', filtered);

// Export as GEE asset
Export.image.toAsset({
    'image': filtered,
    'description': 'CERRADO_C03_rocky_gapfill_frequency_spatial_v' + output_version,
    'assetId': dirout + 'CERRADO_C03_rocky_gapfill_frequency_spatial_v' + output_version,
    'pyramidingPolicy': {'.default': 'mode'},
    'region': classification.geometry(),
    'scale': 10,
    'maxPixels': 1e13
});
