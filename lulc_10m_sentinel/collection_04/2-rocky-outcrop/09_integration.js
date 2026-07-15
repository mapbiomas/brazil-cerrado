// --- --- --- 09_integration
// Post-processing: integration of the classification of 'rocky outcrop' (individual flow) with the classification of native vegetation and anthropic class [21]
// barbara.silva@ipam.org.br and dhemerson.costa@ipam.org.br

// Define input files
var native = ee.Image('projects/mapbiomas-workspace/COLECAO_DEV/COLECAO10_DEV/CERRADO/SENTINEL/C03-POST-CLASSIFICATION/CERRADO_C03_gapfill_v9_sandveg_v4_frequency_v7_temporal_v10_falseReg_v11_geom_v6_spatial_v3');
var rocky = ee.Image('projects/ee-barbarasilvaipam/assets/collection-03_rocky-outcrop/post-classification/CERRADO_C03_rocky_gapfill_frequency_spatial_v6');

print('Input native vegetation classification', native);
print('Input rocky outcrop classification', rocky);

// Define output file
var root = 'projects/mapbiomas-workspace/COLECAO_DEV/COLECAO10_DEV/CERRADO/SENTINEL/C03-POST-CLASSIFICATION/';

// Import MapBiomas color schema
var vis = {
    min: 0,
    max: 62,
    palette: require('users/mapbiomas/modules:Palettes.js').get('classification8'),
    bands: 'classification_2018'
};

// Plot input version
Map.addLayer(native, vis, 'Native vegetation');
Map.addLayer(rocky, vis, 'Rocky outcrop');

// Define ecoregions layer
var regions = ee.Image(1).clip(ee.FeatureCollection('users/dh-conciani/collection7/classification_regions/vector_v2'));

var scale = 10;

// Create a container
var container = ee.Image([]);

// Integrate layers
ee.List.sequence({start: 2017, end: 2024}).getInfo().forEach(function(year) {
    // Get year-specific images
    var nativeYear = native.select(['classification_' + year]);
    var rockyYear = rocky.select(['classification_' + year]);
    
    // Integrate classifications
    var integratedYear = nativeYear.where(nativeYear.neq(3).and(rockyYear.eq(29)), 29);
    
    // Apply a post-integration spatial filter
    // Compute the focal model
    var focalMode = integratedYear
                    .unmask(0)
                    .focal_mode({radius: 2, kernelType: 'square', units: 'pixels'});

    // Compute the number of connections
    var connections = integratedYear
                      .unmask(0)
                      .connectedPixelCount({maxSize: 120, eightConnected: false});

    // Get the focal model when the number of connections of the same class is lower than the parameter
    var toMask = focalMode.updateMask(connections.lte(6));

    // Apply filter
    integratedYear = integratedYear
                     .blend(toMask)
                     .reproject('EPSG:4326', null, 10)
                     .updateMask(regions);

    // Add to container data
    container = container.addBands(integratedYear);
});

// Plot integrated maps
Map.addLayer(container, vis, 'Integrated');
print('Output integrated classification', container);

// Export as GEE asset
Export.image.toAsset({
    image: container,
    description: 'CERRADO_C03_native3_rocky6_v6',
    assetId: root + 'CERRADO_C03_native3_rocky6_v6',
    pyramidingPolicy: {'.default': 'mode'},
    region: native.geometry(),
    scale: scale,
    maxPixels: 1e13
});
