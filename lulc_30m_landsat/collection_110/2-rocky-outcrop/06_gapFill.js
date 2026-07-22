// -- -- -- -- 06) Gap Fill Filter
// This script applies a temporal gap-filling filter to the annual Rocky Outcrop 
// classification maps. It resolves NoData (gaps) in a given year by inheriting 
// valid pixel values from previous years (forward iteration) and subsequent 
// years (backward iteration).

// Define visualization parameters
var vis = {
  min: 1,
  max: 29,
  palette: [
    '#1f8d49','#d6bc74','#519799','#ffefc3','#d4271e','#2532e4',
    '#000000','#000000','#000000','#000000','#000000','#000000',
    '#000000','#000000','#000000','#000000','#000000','#000000',
    '#000000','#000000','#000000','#000000','#000000','#000000',
    '#000000','#000000','#000000','#000000','#000000','#ffaa5f'
  ],
};

// Define the input version 
var inputVersion = '3';

// Define the output version 
var outputVersion = '3';

// Define the root output directory path for the post-classification assets
var out = 'projects/ee-ipam/assets/MAPBIOMAS/LULC/CERRADO_DEV/COL_11/LANDSAT/C11-ROCKY-POST-CLASSIFICATION/';

// Define the base filename for the exported gap-filled asset
var filename = 'CERRADO_C11_rocky_gapfill_v';

// Define the specific geographical bounding polygon covering the Rocky Outcrop extent
var geometry = ee.Geometry.Polygon (
      [[-42.27876222336961,-3.611496375227711], [-48.66181886399461,-6.3856635042521420],
      [-48.815269869544785,-8.471547597267095], [-49.40888917649461,-10.471005736523987],
      [-51.82588136399461,-12.323304945945823], [-58.505568863994604,-14.50323408047685],
      [-58.32978761399461,-22.293613049106090], [-55.60517823899462,-22.374910342856520],
      [-53.012404801494604,-18.46339835112294], [-49.40888917649461,-18.296584445485763],
      [-51.07615618299322,-24.416309808645040], [-50.90302980149462,-26.061168085404727],
      [-42.46552980149461,-19.998585625812040], [-40.34894591003931,-16.910503793082220],
      [-41.586623551494604,-13.82148418684091], [-41.89424073899462,-12.666540189072775],
      [-42.904982926494604,-8.998421853698890], [-43.01648502470223,-8.3575907855271850],
      [-42.70947037851284,-8.1023889537839560], [-40.83955323899461,-7.5633855988623260],
      [-40.09248292649461,-5.3365044496495590], [-40.88349855149462,-3.1015101677947023],
      [-42.04255616868211,-3.3373432698164387], [-42.27876222336961,-3.6114963752277110]]);

// Load the image collection containing the raw rocky outcrop probabilities and classifications
var data = ee.ImageCollection('projects/ee-ipam/assets/MAPBIOMAS/LULC/CERRADO_DEV/COL_11/LANDSAT/C11-ROCKY-GENERAL-MAP-PROBABILITY');

// Define a function to build a single multi-band image from the annual classification collection
var buildCollection = function(input, version, startYear, endYear) {
  // Generate a list of years from the start year to the end year
  var years = ee.List.sequence({'start': startYear, 'end': endYear}).getInfo();
  // Initialize an empty Earth Engine image to serve as the container
  var collection = ee.Image([]);
  
  // Iterate over each year in the generated list
  years.forEach(function(year_i) {
    // Filter the input collection by the specified version and current iteration year
    var tempImage = input.filterMetadata('version', 'equals', version).filterMetadata('year', 'equals', year_i)
      // Map over the filtered collection to extract only the discrete 'classification' band
      .map(function(image) { return image.select('classification'); })
      // Mosaic the images in case of spatial tiles and rename the band to include the year
      .mosaic().rename('classification_' + year_i); 
    // Append the processed annual band to the main container image
    collection = collection.addBands(tempImage);
  });
  
  // Return the fully assembled multi-band image
  return collection;
};

// Call the buildCollection function using the predefined parameters
var collection = buildCollection(
  data,             // input collection
  inputVersion,     // version 
  1985,             // startYear
  2025);            // endyear

// Apply a mask to discard pixels with a value of zero (NoData/Background)
var classificationInput = collection.mask(collection.neq(0));

// Print the assembled multi-band input image to the console
print('Input classification', classificationInput);
Map.addLayer(classificationInput.select(['classification_1988']), vis, 'input');

// Generate a sequence of years to define the temporal range for the gap-fill filter
var years = ee.List.sequence({'start': 1985, 'end': 2025, step: 1}).getInfo();

// Define the core function to apply the temporal gap-fill algorithm
var applyGapFill = function (image) {
    
    // Apply forward gap-fill: fill gaps from t0 (oldest) towards tn (newest)
    var imageFilledt0tn = bandNames.slice(1).iterate(
        function (bandName, previousImage) {
            // Select the current year's band
            var currentImage = image.select(ee.String(bandName));
            // Cast the previous accumulated image state
            previousImage = ee.Image(previousImage);
            // Replace masked pixels (gaps) in the current year with the pixel value from the immediate previous year
            currentImage = currentImage.unmask(previousImage.select([0]));
            // Append the updated current year band to the accumulated image
            return currentImage.addBands(previousImage);
        }, ee.Image(imageAllBands.select([bandNames.get(0)])) // Initialize with the first year band
    );
    
    // Cast the forward-filled result back to an Earth Engine Image
    imageFilledt0tn = ee.Image(imageFilledt0tn);

    // Reverse the band names list to prepare for the backward gap-fill iteration
    var bandNamesReversed = bandNames.reverse();

    // Apply backward gap-fill: fill remaining gaps from tn (newest) towards t0 (oldest)
    var imageFilledtnt0 = bandNamesReversed.slice(1).iterate(
        function (bandName, previousImage) {
            // Select the current year's band from the forward-filled image
            var currentImage = imageFilledt0tn.select(ee.String(bandName));
            // Cast the previous accumulated image state
            previousImage = ee.Image(previousImage);
            // Replace masked pixels in the current year with the pixel value from the subsequent year
            currentImage = currentImage.unmask(previousImage.select(previousImage.bandNames().length().subtract(1)));
            // Append the updated current year band to the accumulated image
            return previousImage.addBands(currentImage);
        }, ee.Image(imageFilledt0tn.select([bandNamesReversed.get(0)])) // Initialize with the last year band
    );

    // Cast the final result, selecting the bands in chronological order
    var imageFilledtnt0Final = ee.Image(imageFilledtnt0).select(bandNames);

    // Return the completed gap-filled image
    return imageFilledtnt0Final;
};

// Extract the corresponding band names formatted as 'classification_YYYY'
var bandNames = ee.List(years.map(function (year) { return 'classification_' + String(year); }));

// Generate a frequency histogram dictionary comparing expected band names against existing image bands
var bandsOccurrence = ee.Dictionary(bandNames.cat(classificationInput.bandNames()).reduce(ee.Reducer.frequencyHistogram()));

// Map over the histogram dictionary to pad missing bands with empty masked images if necessary
var bandsDictionary = bandsOccurrence.map(
    function (key, value) {
        // Evaluate if the band exists (frequency == 2), otherwise create a blank masked band
        return ee.Image(ee.Algorithms.If(
            ee.Number(value).eq(2),
            classificationInput.select([key]).byte(),
            ee.Image().rename([key]).byte().updateMask(classificationInput.select(0))
        ));
    }
);

// Assemble a completely standardized image ensuring all expected bands exist in chronological order
var imageAllBands = ee.Image(
    bandNames.iterate(
        // Add each standardized band from the dictionary to the accumulator image
        function (band, image) { return ee.Image(image).addBands(bandsDictionary.get(ee.String(band))); },
        ee.Image().select() // Initialize with an empty image
    )
);

// Generate a secondary image storing the actual year of the valid pixel to track gap-fill sources
var imagePixelYear = ee.Image.constant(years).updateMask(imageAllBands).rename(bandNames);

// Apply the complete forward-backward gap-fill algorithm to the standardized classification image
var imageFilledtnt0 = applyGapFill(imageAllBands);

// Apply the gap-fill algorithm to the tracking image to identify the origin year of filled pixels
var imageFilledYear = applyGapFill(imagePixelYear);

// Print the final gap-filled classification output details to the console
print('Output classification', imageFilledtnt0);

// Add the gap-filled 2023 classification to the map to verify the correction
Map.addLayer(imageFilledtnt0.select('classification_1988'), vis, 'filtered');

// Embed the output version metadata attribute directly into the output asset properties
imageFilledtnt0 = imageFilledtnt0.set('version', outputVersion);

// Export as GEE Asset
Export.image.toAsset({
    'image': imageFilledtnt0,
    'description': filename + outputVersion,
    'assetId': out + filename + outputVersion,
    'pyramidingPolicy': { '.default': 'mode' },
    'region': geometry,
    'scale': 30,
    'maxPixels': 1e13,
});
