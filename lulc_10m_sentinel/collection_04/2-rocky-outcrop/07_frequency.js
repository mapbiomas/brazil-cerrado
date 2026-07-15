// --- --- --- 07_frequency
// frequency filter 
// barbara.silva@ipam.org.br 

// Import mapbiomas color ramp 
var vis = {
      min: 0,
      max: 62,
      palette:require('users/mapbiomas/modules:Palettes.js').get('classification8'),
      bands: 'classification_2020'
    };
    
// Set metadata 
var input_version = '1';
var output_version = '2';

// Set root directory 
var root = 'projects/ee-barbarasilvaipam/assets/collection-03_rocky-outcrop/post-classification/';
var dirout = 'projects/ee-barbarasilvaipam/assets/collection-03_rocky-outcrop/post-classification/';

// Define input file
var inputFile = 'CERRADO_C03_rocky_gapfill_v' + input_version;

// Load classification
var classification = ee.Image(root + inputFile);
Map.addLayer(classification, vis, 'Input classification');
print ("Input classification", classification);

// Define the function to calculate frequencies 
var filterFreq = function(image) {
    // expression to get frequency
     var exp = '100*((b(0)+b(1)+b(2)+b(3)+b(4)+b(5)+b(6)+b(7)) / 8)';
    
    // Get per class frequency 
    var rocky = image.eq(29).expression(exp);
    Map.addLayer(rocky, {palette:['purple', 'red', 'orange', 'yellow', 'green', 'darkgreen'], min:20, max:70}, 'frequency');
    
    // Stabilize rocky when:
    var filtered = ee.Image(0).where(rocky.gte(99), 29)
                              .where(rocky.lt(99), 99);
    
    // Get only pixels to be filtered
    filtered = filtered.updateMask(filtered.neq(0));

    return image.where(filtered, filtered);
};

// Apply function  
var classification_filtered = filterFreq(classification);

Map.addLayer(classification_filtered, vis, 'Filtered classification');
print ('Filtered classification', classification_filtered);


// Export as GEE asset
Export.image.toAsset({
    'image': classification_filtered,
    'description': 'CERRADO_C03_rocky_gapfill_frequency_v' + output_version,
    'assetId': dirout + 'CERRADO_C03_rocky_gapfill_frequency_v' + output_version,
    'pyramidingPolicy': {
        '.default': 'mode'
    },
    'region': classification.geometry(),
    'scale': 10,
    'maxPixels': 1e13
});
