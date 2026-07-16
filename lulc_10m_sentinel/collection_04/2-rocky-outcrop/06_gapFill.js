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
    '#000000','#723d46','#000000','#000000','#000000','#000000',
    '#000000','#000000','#000000','#000000','#000000','#000000',
    '#000000','#000000','#000000','#000000','#000000','#ffaa5f'
  ],
};

// Define the input version 
var inputVersion = '1';

// Define the output version 
var outputVersion = '1';

// Define the root output directory path for the post-classification assets
var out = 'projects/ee-ipam/assets/MAPBIOMAS/LULC/CERRADO_DEV/COL_11/SENTINEL/C04-ROCKY-POST-CLASSIFICATION/';

// Define the base filename for the exported gap-filled asset
var filename = 'CERRADO_C04_rocky_gapfill_v';

// Define the specific geographical bounding polygon covering the Rocky Outcrop extent
var geometry = ee.Geometry.Polygon([[
  [-43.31147706711961, -3.808835721093122], [-48.66181886399461, -6.385663504252142],
  [-49.298668307044785, -8.51501096897931], [-49.07929933274461, -10.53581918353168],
  [-50.639357926494604, -13.9068142507549], [-58.505568863994604, -14.5032340804768],
  [-58.32978761399461, -22.29361304910609], [-55.60517823899462, -22.37491034285652],
  [-53.012404801494604, -18.4633983511229], [-49.18916261399461, -17.92066736932658],
  [-51.07615618299322, -24.41630980864504], [-50.90302980149462, -26.06116808540472],
  [-42.46552980149461, -19.99858562581204], [-39.90949278503931, -16.19439805652448],
  [-41.586623551494604, -13.8214841868409], [-41.89424073899462, -12.66654018907277],
  [-42.904982926494604, -8.99842185369889], [-43.01648502470223, -8.357590785527185],
  [-42.70947037851284, -8.102388953783956], [-40.83955323899461, -7.563385598862326],
  [-40.09248292649461, -5.336504449649559], [-40.00459230149461, -2.487010249675636],
  [-41.19897078173509, -2.429764821575260], [-42.43806398118211, -2.810760200204854],
  [-42.72920167649461, -3.556672175749491], [-43.31147706711961, -3.808835721093122]
]]);

// Load the image collection containing the raw rocky outcrop probabilities and classifications
var data = ee.ImageCollection('projects/mapbiomas-workspace/COLECAO_DEV/COLECAO10_DEV/CERRADO/SENTINEL/C04_ROCKY-MAP-PROBABILITY');

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
Map.addLayer(classificationInput.select(['classification_2023']), vis, 'input');

// Generate a sequence of years to define the temporal range for the gap-fill filter
var years = ee.List.sequence({'start': 2017, 'end': 2024, step: 1}).getInfo();

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
Map.addLayer(imageFilledtnt0.select('classification_2023'), vis, 'filtered');

// Embed the output version metadata attribute directly into the output asset properties
imageFilledtnt0 = imageFilledtnt0.set('version', outputVersion);

// Export as GEE Asset
Export.image.toAsset({
    'image': imageFilledtnt0,
    'description': filename + outputVersion,
    'assetId': out + filename + outputVersion,
    'pyramidingPolicy': { '.default': 'mode' },
    'region': geometry,
    'scale': 10,
    'maxPixels': 1e13,
});
