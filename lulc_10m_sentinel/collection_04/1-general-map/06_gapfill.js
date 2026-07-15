// -- -- -- -- 06) Gap Fill Filter
// This script applies a temporal gap-filling filter to the annual LULC 
// classification maps. It resolves NoData (gaps) in a given year by inheriting 
// valid pixel values from previous years (forward iteration) and subsequent 
// years (backward iteration).

// Define visualization parameters
var vis = {
    min: 0,
    max: 75,
    palette:require('users/mapbiomas/modules:Palettes.js').get('brazil'),
    bands: 'classification_2020'
};

// Set Cerrado extent for the final export
var geometry = ee.Geometry.Polygon(
      [[[-61.23436115564828, -1.2109638051779688],
        [-61.23436115564828, -26.098552002927054],
        [-40.31639240564828, -26.098552002927054],
        [-40.31639240564828, -1.2109638051779688]]], null, false);

// Define the root output directory
var out = 'projects/ee-ipam/assets/MAPBIOMAS/LULC/CERRADO_DEV/COL_11/SENTINEL/C04-POST-CLASSIFICATION/';

// Define the input version
var inputVersion = '3';

// Define the output version
var outputVersion = '3';

// Print the input version to the console for tracking purposes
print ("Classification Version: ", inputVersion);

// Load the image collection containing the raw general map probabilities and classifications
var data = ee.ImageCollection('projects/ee-ipam/assets/MAPBIOMAS/LULC/CERRADO_DEV/COL_11/SENTINEL/C04_GENERAL-MAP-PROBABILITY');

// Define a function to build a single multi-band image from the annual classification collection
var buildCollection = function(input, version, startYear, endYear) {
  var years = ee.List.sequence({'start': startYear, 'end': endYear}).getInfo();
  var collection = ee.Image([]);
  
  // Iterate over each year in the generated list
  years.forEach(function(year_i) {
    var tempImage = input.filterMetadata('version', 'equals', version)
                        .filterMetadata('year', 'equals', year_i)
                        .map(function(image) {
                          return image.select('classification');
                        })
                        .mosaic()
                        .rename('classification_' + year_i); 
    collection = collection.addBands(tempImage);
    });
  
  // Return the fully assembled multi-band image
  return collection;
};

// Call the buildCollection function using the predefined parameters
var collection = buildCollection(
  data,             // input collection
  inputVersion,     // version 
  2017,             // startYear
  2025);            // endyear

// Apply a mask to discard pixels with a value of zero (NoData/Background)
var classificationInput = collection.mask(collection.neq(0));

print('Input classification', classificationInput);
Map.addLayer(classificationInput, vis, 'Input classification');

// Gap Fill Processing Functions
// Generate a sequence of years to define the temporal range for the gap-fill filter
var years = ee.List.sequence({'start': 2017, 'end': 2025, step: 1}).getInfo();

// Extract the corresponding band names formatted as 'classification_YYYY'
var bandNames = ee.List(years.map(function (year) { return 'classification_' + String(year); }));

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
                currentImage = currentImage.unmask(
                    previousImage.select([0]));
                // Append the updated current year band to the accumulated image
                return currentImage.addBands(previousImage);

            }, ee.Image(imageAllBands.select([bandNames.get(0)]))
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
                currentImage = currentImage.unmask(
                                previousImage.select(previousImage.bandNames().length().subtract(1)));
                // Append the updated current year band to the accumulated image
                return previousImage.addBands(currentImage);

            }, ee.Image(imageFilledt0tn.select([bandNamesReversed.get(0)]))
        );
        
    // Cast the final result, selecting the bands in chronological order
    imageFilledtnt0 = ee.Image(imageFilledtnt0).select(bandNames);

    return imageFilledtnt0;
};

// Generate a frequency histogram dictionary comparing expected band names against existing image bands
var bandsOccurrence = ee.Dictionary(
    bandNames.cat(classificationInput.bandNames()).reduce(ee.Reducer.frequencyHistogram()));

// Map over the histogram dictionary to pad missing bands with empty masked images if necessary
var bandsDictionary = bandsOccurrence.map(
    function (key, value) {
        // Evaluate if the band exists (frequency == 2), otherwise create a blank masked band
        return ee.Image(
            ee.Algorithms.If(
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
        function (band, image) {
            return ee.Image(image).addBands(bandsDictionary.get(ee.String(band)));
        },
        ee.Image().select()
    )
);

// Apply the complete forward-backward gap-fill algorithm to the standardized image
var imageFilledtnt0 = applyGapFill(imageAllBands);

// Add the gap-filled classification to the map to verify the correction
Map.addLayer(imageFilledtnt0, vis, 'Filtered classification');

// Set a metadata property 
imageFilledtnt0 = imageFilledtnt0.set('06_gapfill', outputVersion);

// Print the final output classification image details to the console
print('Output classification', imageFilledtnt0);

// Export as GEE asset
Export.image.toAsset({
    'image': imageFilledtnt0,
    'description': 'CERRADO_C04_gapfill_v' + outputVersion,
    'assetId': out + 'CERRADO_C04_gapfill_v' + outputVersion,
    'pyramidingPolicy': {
        '.default': 'mode'
    },
    'region': geometry,
    'scale': 10,
    'maxPixels': 1e13
});
