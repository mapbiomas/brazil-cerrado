// --- --- --- 06_gapFill
// Temporal gap-filling of classification maps using previous and next valid years
// Description: This script applies a temporal gap-filling filter to a time series of classified images (1985–2024), 
// filling NoData pixels using valid observations from previous or subsequent years.

// Author: barbara.silva@ipam.org.br

// Import MapBiomas color palette
var vis = {
  min: 0,
  max: 62,
  palette: require('users/mapbiomas/modules:Palettes.js').get('classification8')
};

// Define the target geometry (rocky outcrop extent)
var geometry = ee.Geometry.Polygon([[
  [-42.278762, -3.611496], [-48.661819, -6.385664], [-48.793655, -10.557421],
  [-50.639358, -13.906814], [-58.505569, -14.503234], [-58.329788, -22.293613],
  [-55.605178, -22.374910], [-53.012405, -18.463398], [-49.189163, -17.920667],
  [-51.076156, -24.416310], [-50.903030, -26.061168], [-42.465530, -19.998586],
  [-41.586624, -13.821484], [-41.894241, -12.666540], [-42.904983, -8.998422],
  [-43.016485, -8.357591], [-42.709470, -8.102389], [-40.839553, -7.563386],
  [-40.092483, -5.336504], [-40.883499, -3.101510], [-42.042556, -3.337343],
  [-42.278762, -3.611496]
]]);

// Define input/output metadata
var inputVersion = '4';
var outputVersion = '4';
var out = 'projects/ee-barbarasilvaipam/assets/collection-10_rocky-outcrop/post-classification/';
var filename = 'CERRADO_C10_rocky_gapfill_v';

// Load classified image collection
var data = ee.ImageCollection(
  'projects/mapbiomas-workspace/COLECAO_DEV/COLECAO10_DEV/CERRADO/LANDSAT/C10-ROCKY-GENERAL-MAP-PROBABILITY'
);

// Build classification time series from image collection
var buildCollection = function(input, version, startYear, endYear) {
  var years = ee.List.sequence(startYear, endYear).getInfo();
  var collection = ee.Image([]);
  years.forEach(function(year) {
    var image = input
      .filterMetadata('version', 'equals', version)
      .filterMetadata('year', 'equals', year)
      .map(function(img) {
        return img.select('classification');
      })
      .mosaic()
      .rename('classification_' + year);
    collection = collection.addBands(image);
  });
  return collection;
};

var collection = buildCollection(data, inputVersion, 1985, 2024);

// Remove zero-class pixels
var classificationInput = collection.mask(collection.neq(0));
Map.addLayer(classificationInput.select('classification_2023'), vis, 'Input');

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

// Generate image of pixel years (used for metadata fill)
var imagePixelYear = ee.Image.constant(years)
  .updateMask(imageAllBands)
  .rename(bandNames);

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
var imageFilledYear = applyGapFill(imagePixelYear);

Map.addLayer(imageFilled.select('classification_2023'), vis, 'Gap-filled');

// Add metadata
imageFilled = imageFilled.set('version', outputVersion);

// Export as Earth Engine asset
Export.image.toAsset({
  image: imageFilled,
  description: filename + outputVersion,
  assetId: out + filename + outputVersion,
  pyramidingPolicy: { '.default': 'mode' },
  region: geometry,
  scale: 30,
  maxPixels: 1e13
});
