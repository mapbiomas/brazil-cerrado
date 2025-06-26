// -- -- -- -- toWorkspace

// Export cerrado classification as a multiband image for the integration step

// Author: barbara.silva@ipam.org.br

// Input asset
var assetInput = 'projects/mapbiomas-workspace/COLECAO_DEV/COLECAO10_DEV/CERRADO/LANDSAT/C10-POST-CLASSIFICATION/';
var fileName = 'CERRADO_C10_native11_sp10_rocky6_gf';

// Classification input
var collection = ee.Image(assetInput + fileName);
print('Processing file', fileName);
print('Input collection', collection);

Map.addLayer(collection, {}, 'Input data');

// Output asset
var assetOutput = 'projects/mapbiomas-brazil/assets/LAND-COVER/COLLECTION-10/GENERAL/classification-cer-ft';

// Output version
var outputVersion = '16';

// Set the MapBiomas collection launch ID
var collectionId = 10.0;

// Define the biome or cross-cutting theme
var theme = {type: 'biome', name: 'CERRADO'};

// Define the data source
var source = 'ipam';

// Import MapBiomas color ramp
var palette = require('users/mapbiomas/modules:Palettes.js').get('classification8');

// List of years
var years = [
    '1985', '1986', '1987', '1988',
    '1989', '1990', '1991', '1992',
    '1993', '1994', '1995', '1996',
    '1997', '1998', '1999', '2000',
    '2001', '2002', '2003', '2004',
    '2005', '2006', '2007', '2008',
    '2009', '2010', '2011', '2012',
    '2013', '2014', '2015', '2016',
    '2017', '2018', '2019', '2020',
    '2021', '2022', '2023', '2024'
];

// Define the bounding box for Brazil
var geometry = ee.Geometry.Polygon(
    [
        [
            [-75.46319738935682, 6.627809464162168],
            [-75.46319738935682, -34.62753178950752],
            [-32.92413488935683, -34.62753178950752],
            [-32.92413488935683, 6.627809464162168]
        ]
    ], null, false
);

// Loop through each year
years.forEach(function(year) {
    var imageYear = collection.select('classification_' + year);

    imageYear = imageYear.rename('classification');

    // Set properties for the image
    imageYear = imageYear
        .set('territory', 'BRAZIL')
        .set('biome', 'CERRADO')
        .set('collection_id', collectionId)
        .set('version', outputVersion)
        .set('source', source)
        .set('year', parseInt(year, 10))
        .set('description', fileName);

    var vis = {
        min: 0,
        max: 62,
        palette: palette,
        format: 'png'
    };

    var name = year + '-' + outputVersion;

    if (theme.type === 'biome') {
        name = theme.name + '-' + name;
    }

    // Reclassify the mosaic of uses in Alto Paraguai watershed (BAP) with the Pantanal biome
    var assetPantanal = ee.Image('projects/mapbiomas-brazil/assets/LAND-COVER/COLLECTION-10/GENERAL/classification-pan-ft/PANT_col10_Anual_29');
    var pantanalYear = assetPantanal.select('classification_' + year);
    var bapBoundaries = ee.Image(1).clip(ee.FeatureCollection('projects/barbaracosta-ipam/assets/collection-9/BAP_limit'));

    imageYear = imageYear.where(imageYear.eq(21)
        .and(pantanalYear.eq(3))
        .and(bapBoundaries.eq(1)), 4);

    imageYear = imageYear.where(imageYear.eq(21)
        .and(pantanalYear.eq(4))
        .and(bapBoundaries.eq(1)), 4);
        
    imageYear = imageYear.where(imageYear.eq(21)
        .and(pantanalYear.eq(11))
        .and(bapBoundaries.eq(1)), 11);
            
    imageYear = imageYear.where(imageYear.eq(21)
        .and(pantanalYear.eq(12))
        .and(bapBoundaries.eq(1)), 12);

    // Reclassify the Forest Formation in Stadual park of Boa Esperanã with the Altantic Forest biome
    var assetAtlanticForest = ee.ImageCollection ('projects/mapbiomas-brazil/assets/LAND-COVER/COLLECTION-10/GENERAL/classification-mat-ft')
                                .filterMetadata('version', 'equals', '77_Sf').mosaic();
    var AtlanticForestYear = assetAtlanticForest.select('classification_' + year);
    
    var ucBoundaries = ee.Image(1).clip(ee.FeatureCollection(ee.Geometry.Polygon([[-45.749818695323924,-20.919350274389323], [-45.72921933008955,-20.98155165309904],
                                                            [-45.70621670557783,-21.027064093058], [-45.62656582667158,-21.031870934295934],
                                                            [-45.59360684229658,-20.99148865163892], [-45.64613522364424,-20.90780490808815],
                                                            [-45.70896328760908,-20.855518938139554], [-45.749818695323924,-20.919350274389323]])));    

    imageYear = imageYear.where(imageYear.eq(3).or(imageYear.eq(4)).or(imageYear.eq(11)).or(imageYear.eq(29)).or(imageYear.eq(21))
                .and(AtlanticForestYear.eq(12))
                .and(ucBoundaries.eq(1)), 12);
    
    // Add the processed image to the map
    Map.addLayer(imageYear, vis, theme.name + ' ' + year, false);
    print('Output year: ' + year, imageYear);
    
    // Export the image to an asset
    Export.image.toAsset({
        image: imageYear,
        description: name,
        assetId: assetOutput + '/' + name,
        pyramidingPolicy: {'.default': 'mode'},
        region: geometry,
        scale: 30,
        maxPixels: 1e13
    });

});

// Add the Cerrado boundary to the map
var cerrado = ee.FeatureCollection('projects/mapbiomas-workspace/AUXILIAR/biomas-2019').filter(ee.Filter.eq('Bioma', 'Cerrado'));
var line = ee.Image().paint(cerrado, 'empty', 3).visualize({palette: 'FF0000'});
Map.addLayer(cerrado, {min: 0, max: 1}, 'Cerrado limit');
