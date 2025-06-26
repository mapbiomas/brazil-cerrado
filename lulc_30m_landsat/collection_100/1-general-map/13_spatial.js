// -- -- -- -- 13_spatial
// Post-processing filter to remove isolated or edge pixels in classified images (minimum area: 6 pixels)

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
var outputVersion = '10';

// Define input file
var inputFile = 'CERRADO_C10_gapfill_v11_incidence_v4_sandVeg_v3_freq_v7_temp_v16_falseReg_v29_geo_v'+inputVersion;

// Load classification image
var classificationInput = ee.Image(root + inputFile);
print('Input classification', classificationInput);
Map.addLayer(classificationInput, vis, 'Input classification');

// Create empty image container for output
var filtered = ee.Image([]);

// Define spatial filter threshold (number of connected pixels)
var filter_size = 8;

// First round of spatial filtering (remove small patches based on neighborhood mode)
ee.List.sequence({'start': 1985, 'end': 2024}).getInfo()
      .forEach(function(year_i) {
        // Calculate focal mode (most frequent neighbor value)
        var focal_mode = classificationInput.select(['classification_' + year_i])
                .unmask(0)
                .focal_mode({'radius': 1, 'kernelType': 'square', 'units': 'pixels'});
 
        // Calculate number of connected pixels with same class
        var connections = classificationInput.select(['classification_' + year_i])
                .unmask(0)
                .connectedPixelCount({'maxSize': 100, 'eightConnected': false});
        
        // Mask isolated pixels below threshold and replace with focal mode
        var to_mask = focal_mode.updateMask(connections.lte(filter_size));
        var classification_i = classificationInput.select(['classification_' + year_i])
                .blend(to_mask)
                .reproject('EPSG:4326', null, 30);

        filtered = filtered.addBands(classification_i.updateMask(classification_i.neq(0)));
        }
      );

Map.addLayer(filtered, vis, 'filtered - round 1');

// Second round of spatial filtering (refinement)
var container = ee.Image([]);

ee.List.sequence({'start': 1985, 'end': 2024}).getInfo()
      .forEach(function(year_i) {
        // Compute the focal model
        var focal_mode = filtered.select(['classification_' + year_i])
                .unmask(0)
                .focal_mode({'radius': 1, 'kernelType': 'square', 'units': 'pixels'});
 
        // Compute te number of connections
        var connections = filtered.select(['classification_' + year_i])
                .unmask(0)
                .connectedPixelCount({'maxSize': 100, 'eightConnected': false});
        
        //Get the focal model when the number of connections of same class is lower than parameter
        var to_mask = focal_mode.updateMask(connections.lte(filter_size));

        // Apply filter
        var classification_i = filtered.select(['classification_' + year_i])
                .blend(to_mask)
                .reproject('EPSG:4326', null, 30);

        // Stack into container
        container = container.addBands(classification_i.updateMask(classification_i.neq(0)));
        }
      );

Map.addLayer(container, vis, 'filtered - round 2');

// Third round: Fill remaining zero values (gaps) using a larger neighborhood
var container2 = ee.Image([]);

ee.List.sequence({'start': 1985, 'end': 2024}).getInfo()
  .forEach(function(year_i) {
    // Apply focal mode with larger radius (fill gaps)
    var focal_mode =  container.select(['classification_' + year_i])
                .unmask(0)
                .focal_mode({'radius': 4, 'kernelType': 'square', 'units': 'pixels'});
                
    // Identify pixels that remain as 0 (gaps)
    var to_mask = focal_mode.updateMask(container.select(['classification_2010']).unmask(0).eq(0));
  
    var classification_i = container.select(['classification_' + year_i])
                .blend(to_mask)
                .reproject('EPSG:4326', null, 30);
    
    container2 = container2.addBands(classification_i.updateMask(classification_i.neq(0)));
  });

Map.addLayer(container2, vis, 'filtered - round 3');

// Add coral reef mask (class 33) to classification
var regions = ee.FeatureCollection('users/dh-conciani/collection7/classification_regions/vector_v2').filter(ee.Filter.eq('mapb', 1));
var mask = ee.Image(33).clip(regions);

container2 = mask.blend(container2);

Map.addLayer(container2, vis, 'Output classification');
print('Output classification', container2);

// export as GEE asset
Export.image.toAsset({
    'image': container2,
    'description': inputFile+ '_sp_v' + outputVersion,
    'assetId': out + inputFile+ '_sp_v' + outputVersion,
    'pyramidingPolicy': {
        '.default': 'mode'
    },
    'region': classificationInput.geometry(),
    'scale': 30,
    'maxPixels': 1e13
});
