// -- -- -- -- 06_gapFill
// Temporal gap-filling of classification maps using previous and next valid years
// Description: This script applies a temporal gap-filling filter to a time series of classified images (1985–2024), 
// filling NoData pixels using valid observations from previous or subsequent years.

// Author: barbara.silva@ipam.org.br

// Import MapBiomas color palette
var vis = {
    min: 0,
    max: 62,
    palette:require('users/mapbiomas/modules:Palettes.js').get('classification8')
};

// Define the target geometry (Cerrado biome extent) 
var geometry = ee.Geometry.Polygon(
      [[[-61.23436115564828, -1.2109638051779688],
        [-61.23436115564828, -26.098552002927054],
        [-40.31639240564828, -26.098552002927054],
        [-40.31639240564828, -1.2109638051779688]]], null, false);

// Define input/output metadata
var out = 'projects/mapbiomas-workspace/COLECAO_DEV/COLECAO10_DEV/CERRADO/LANDSAT/C10-POST-CLASSIFICATION/';
var inputVersion = '11';
var outputVersion = '11';

// Load classified image collection
var data = ee.ImageCollection('projects/mapbiomas-workspace/COLECAO_DEV/COLECAO10_DEV/CERRADO/LANDSAT/C10-GENERAL-MAP-PROBABILITY');

// Build classification time series from image collectio
var buildCollection = function(input, version, startYear, endYear) {
  var years = ee.List.sequence({'start': startYear, 'end': endYear}).getInfo();
  var collection = ee.Image([]);
  years.forEach(function(year_i) {
    var tempImage = input.filterMetadata('version', 'equals', version)
                        .filterMetadata('year', 'equals', year_i)
                        .map(function(image) {
                          return image.select('classification');
                        })
                        .mosaic()
                        .rename('classification_' + year_i); 
    collection = collection.addBands(tempImage);
    }
  );
  return collection;
};

var collection = buildCollection(data, inputVersion, 1985, 2024);

// Remove zero-class pixels
var classificationInput = collection.mask(collection.neq(0));
print ('Input classification', classificationInput);
Map.addLayer(classificationInput.select('classification_2023'), vis, 'Input classification');

// List of years
var years = ee.List.sequence(1985, 2024).getInfo();

// Create list of band names
var bandNames = ee.List(
  years.map(function(year) {
    return 'classification_' + String(year);
  })
);

// Generate dictionary with occurrence info for each band
var bandsOccurrence = ee.Dictionary(
  bandNames.cat(classificationInput.bandNames()).reduce(ee.Reducer.frequencyHistogram())
);

// Create dictionary with valid or masked bands
var bandsDictionary = bandsOccurrence.map(function(key, value) {
  return ee.Image(
    ee.Algorithms.If(
      ee.Number(value).eq(2),
      classificationInput.select([key]).byte(),
      ee.Image().rename([key]).byte().updateMask(classificationInput.select(0))
    )
  );
});

// Assemble full image from dictionary
var imageAllBands = ee.Image(
  bandNames.iterate(function(band, img) {
    return ee.Image(img).addBands(bandsDictionary.get(ee.String(band)));
  }, ee.Image().select())
);


// Gap-fill function: forward then backward
var applyGapFill = function(image) {
  // Forward fill (t0 → tn)
  var imageFilled_t0tn = bandNames.slice(1).iterate(function(band, previousImage) {
    var curr = image.select(ee.String(band));
    previousImage = ee.Image(previousImage);
    var filled = curr.unmask(previousImage.select(0));
    return filled.addBands(previousImage);
  }, ee.Image(imageAllBands.select([bandNames.get(0)])));
  imageFilled_t0tn = ee.Image(imageFilled_t0tn);

  // Backward fill (tn → t0)
  var reversed = bandNames.reverse();
  var imageFilled_tnt0 = reversed.slice(1).iterate(function(band, previousImage) {
    var curr = imageFilled_t0tn.select(ee.String(band));
    previousImage = ee.Image(previousImage);
    var filled = curr.unmask(previousImage.select(previousImage.bandNames().length().subtract(1)));
    return previousImage.addBands(filled);
  }, ee.Image(imageFilled_t0tn.select([reversed.get(0)])));

  return ee.Image(imageFilled_tnt0).select(bandNames);
};

// Apply gap-filling
var imageFilled = applyGapFill(imageAllBands);

Map.addLayer(imageFilled.select('classification_2023'), vis, 'Output classification');

// Add metadata
imageFilled = imageFilled.set('version', outputVersion);
print('Output classification', imageFilled);

// Export as GEE asset
Export.image.toAsset({
    'image': imageFilled,
    'description': 'CERRADO_C10_gapfill_v' + outputVersion,
    'assetId': out + 'CERRADO_C10_gapfill_v' + outputVersion,
    'pyramidingPolicy': {
        '.default': 'mode'
    },
    'region': geometry,
    'scale': 30,
    'maxPixels': 1e13
});
