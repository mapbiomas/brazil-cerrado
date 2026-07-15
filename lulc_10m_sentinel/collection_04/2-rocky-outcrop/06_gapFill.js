// -- -- -- -- 06_gapFill
// post-processing filter: fill gaps (nodata) with data from previous years
// barbara.silva@ipam.org.br

// Import mapbiomas color schema 
var vis = {
    min: 0,
    max: 62,
    palette:require('users/mapbiomas/modules:Palettes.js').get('classification8')
};

// Set the rocky outcrop extent 
var geometry = ee.Geometry.Polygon (
[[
[-42.27876222336961,-3.611496375227711],
[-48.66181886399461,-6.385663504252142],
[-48.793654801494604,-10.557420640233373],
[-50.639357926494604,-13.90681425075495],
[-58.505568863994604,-14.503234080476853],
[-58.32978761399461,-22.29361304910609],
[-55.60517823899462,-22.37491034285652],
[-53.012404801494604,-18.463398351122947],
[-49.18916261399461,-17.920667369326587],
[-51.07615618299322,-24.41630980864504],
[-50.90302980149462,-26.061168085404727],
[-42.46552980149461,-19.998585625812044],
[-41.586623551494604,-13.82148418684091],
[-41.89424073899462,-12.666540189072775],
[-42.904982926494604,-8.99842185369889],
[-43.01648502470223,-8.357590785527185],
[-42.70947037851284,-8.102388953783956],
[-40.83955323899461,-7.563385598862326],
[-40.09248292649461,-5.336504449649559],
[-40.88349855149462,-3.1015101677947023],
[-42.04255616868211,-3.3373432698164387],
[-42.27876222336961,-3.611496375227711]
]]);

// Set root directory
var out = 'projects/ee-barbarasilvaipam/assets/collection-03_rocky-outcrop/post-classification/';
var filename = 'CERRADO_C02_rocky_gapfill_v';

// set metadata 
var inputVersion = '1';
var outputVersion = '1';

var data = ee.ImageCollection('projects/mapbiomas-workspace/COLECAO_DEV/COLECAO10_DEV/CERRADO/SENTINEL/C03_ROCKY-MAP-PROBABILITY');

// Function to build collection as ee.Image
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

var collection = buildCollection(
  data,             // input collection
  inputVersion,     // version 
  2017,             // startYear
  2024);            // endyear

// Discard zero pixels in the image
var classificationInput = collection.mask(collection.neq(0));
print('Input classification', classificationInput);
Map.addLayer(classificationInput.select(['classification_2023']), vis, 'input');

// set the list of years to be filtered
var years = ee.List.sequence({'start': 2017, 'end': 2024, step: 1}).getInfo();

// User defined functions
var applyGapFill = function (image) {

    // apply the gapfill from t0 until tn
    var imageFilledt0tn = bandNames.slice(1)
        .iterate(
            function (bandName, previousImage) {

                var currentImage = image.select(ee.String(bandName));

                previousImage = ee.Image(previousImage);

                currentImage = currentImage.unmask(
                    previousImage.select([0]));

                return currentImage.addBands(previousImage);

            }, ee.Image(imageAllBands.select([bandNames.get(0)]))
        );

    imageFilledt0tn = ee.Image(imageFilledt0tn);

    // apply the gapfill from tn until t0
    var bandNamesReversed = bandNames.reverse();

    var imageFilledtnt0 = bandNamesReversed.slice(1)
        .iterate(
            function (bandName, previousImage) {

                var currentImage = imageFilledt0tn.select(ee.String(bandName));

                previousImage = ee.Image(previousImage);

                currentImage = currentImage.unmask(
                    previousImage.select(previousImage.bandNames().length().subtract(1)));

                return previousImage.addBands(currentImage);

            }, ee.Image(imageFilledt0tn.select([bandNamesReversed.get(0)]))
        );

    imageFilledtnt0 = ee.Image(imageFilledtnt0).select(bandNames);

    return imageFilledtnt0;
};

// Get band names list 
var bandNames = ee.List(
    years.map(
        function (year) {
            return 'classification_' + String(year);
        }
    )
);

// Generate a histogram dictionary of [bandNames, image.bandNames()]
var bandsOccurrence = ee.Dictionary(
    bandNames.cat(classificationInput.bandNames()).reduce(ee.Reducer.frequencyHistogram())
);

// Insert a masked band 
var bandsDictionary = bandsOccurrence.map(
    function (key, value) {
        return ee.Image(
            ee.Algorithms.If(
                ee.Number(value).eq(2),
                classificationInput.select([key]).byte(),
                ee.Image().rename([key]).byte().updateMask(classificationInput.select(0))
            )
        );
    }
);

// Convert dictionary to image
var imageAllBands = ee.Image(
    bandNames.iterate(
        function (band, image) {
            return ee.Image(image).addBands(bandsDictionary.get(ee.String(band)));
        },
        ee.Image().select()
    )
);

// Generate image pixel years
var imagePixelYear = ee.Image.constant(years)
    .updateMask(imageAllBands)
    .rename(bandNames);

// Apply the gapfill
var imageFilledtnt0 = applyGapFill(imageAllBands);
var imageFilledYear = applyGapFill(imagePixelYear);

// Check filtered image
print ('output classification', imageFilledtnt0);
Map.addLayer(imageFilledtnt0.select('classification_2023'), vis, 'filtered');

// Write metadata
imageFilledtnt0 = imageFilledtnt0.set('version', outputVersion);

// Export as GEE asset
Export.image.toAsset({
    'image': imageFilledtnt0,
    'description': filename + outputVersion,
    'assetId': out + filename + outputVersion,
    'pyramidingPolicy': {'.default': 'mode'},
    'region': geometry,
    'scale': 10,
    'maxPixels': 1e13,
});
