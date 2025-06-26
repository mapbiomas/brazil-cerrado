// --- --- --- 09_integration
// Integrates native vegetation classification with rocky outcrop classification
// This script integrates the rocky outcrop classification into the final native vegetation classification. 
// It ensures spatial consistency and applies post-integration corrections, including adjustments to grassland (class 12) and forest formation (class 3) to maintain temporal coherence

// Author: barbara.silva@ipam.org.br

// Load input classification images
var native = ee.Image('projects/mapbiomas-workspace/COLECAO_DEV/COLECAO10_DEV/CERRADO/LANDSAT/C10-POST-CLASSIFICATION/CERRADO_C10_gapfill_v11_incidence_v4_sandVeg_v3_freq_v7_temp_v16_falseReg_v29_geo_v11_sp_v10');
var rocky = ee.Image('projects/ee-barbarasilvaipam/assets/collection-10_rocky-outcrop/post-classification/CERRADO_C10_rocky_gapfill_frequency_spatial_v6');

print('Input native vegetation classification', native);
print('Input rocky outcrop classification', rocky);

// Load MapBiomas visualization palette
var vis = {
    min: 0,
    max: 62,
    palette: require('users/mapbiomas/modules:Palettes.js').get('classification8')
};

// Display input classifications
Map.addLayer(native.select(['classification_2000']), vis, 'Native vegetation 2000');
Map.addLayer(rocky.select(['classification_2000']), vis, 'Rocky outcrop 2000');

// Load classification regions
var regions = ee.Image(1).clip(ee.FeatureCollection('users/dh-conciani/collection7/classification_regions/vector_v2'));
var geometry = regions.geometry();
var scale = 30;

// Initialize image container
var container = ee.Image([]);

// Integrate rocky outcrop classification into native vegetation classification
ee.List.sequence({start: 1985, end: 2024}).getInfo().forEach(function(year) {
    var nativeYear = native.select(['classification_' + year]);
    var rockyYear = rocky.select(['classification_' + year]);

    var integratedYear = nativeYear.where(rockyYear.eq(29), 29);

    // Apply spatial smoothing and clean isolated pixels
    var focalMode = integratedYear
        .unmask(0)
        .focal_mode({radius: 1, kernelType: 'square', units: 'pixels'});

    var connections = integratedYear
        .unmask(0)
        .connectedPixelCount({maxSize: 100, eightConnected: false});

    var toMask = focalMode.updateMask(connections.lte(6));

    integratedYear = integratedYear
        .blend(toMask)
        .reproject('EPSG:4326', null, 30)
        .updateMask(regions);

    container = container.addBands(integratedYear.rename('classification_' + year));
});

// Correction of class 12 (Grassland formation)
function correctGrassland(currentBand, previousBand) {
    var mask = currentBand.eq(12).and(previousBand.neq(12));
    return currentBand.where(mask, previousBand);
}

var years = ee.List.sequence(1985, 2024);
var correctedContainer = container;

for (var i = 1; i < years.length().getInfo(); i++) {
    var currentYear = years.get(i).getInfo();
    var previousYear = years.get(i - 1).getInfo();

    var currentBand = correctedContainer.select('classification_' + currentYear);
    var previousBand = correctedContainer.select('classification_' + previousYear);

    var correctedBand = correctGrassland(currentBand, previousBand);

    correctedContainer = correctedContainer.addBands(
        correctedBand.rename('classification_' + currentYear), null, true
    );
}

// Correction of class 3 (Forest formation) in 2024
var forest2023 = correctedContainer.select('classification_2023');
var forest2024 = correctedContainer.select('classification_2024');

var forestMask = forest2024.eq(3).and(forest2023.neq(3));
var corrected2024 = forest2024.where(forestMask, forest2023);

correctedContainer = correctedContainer.addBands(
    corrected2024.rename('classification_2024'), null, true
);

// Display result of temporal corrections
Map.addLayer(correctedContainer.select(['classification_2000']), vis, 'Corrected classification 2000');

// Define asset paths
var root = 'projects/mapbiomas-workspace/COLECAO_DEV/COLECAO10_DEV/CERRADO/LANDSAT/C10-POST-CLASSIFICATION/';

// Export integrated image as GEE asset
Export.image.toAsset({
    image: correctedContainer,
    description: 'CERRADO_C10_native11_sp10_rocky6_gf',
    assetId: root + 'CERRADO_C10_native11_sp10_rocky6_gf',
    pyramidingPolicy: {'.default': 'mode'},
    region: native.geometry(),
    scale: 30,
    maxPixels: 1e13
});
