// -- -- -- -- 07) 1st Spatial Filter
// This script applies a spatial filter to the annual LULC classification maps.
// It removes small isolated patches (Minimum Mappable Unit) and replaces them
// with the focal mode of a 9x9 pixel neighborhood. Specific classes (e.g., 
// Forest, Wetland, Water) are protected from filtering to preserve fine 
// ecological features.


// Define visualization parameters
var vis = {
  min: 0,
  max: 75,
  palette: require('users/mapbiomas/modules:Palettes.js').get('brazil'),
  bands: 'classification_2018'
};

// Define the input version
var inputVersion = '17';

// Define the output version
var outputVersion = '2';

// Define the base directory
var root = 'projects/ee-ipam/assets/MAPBIOMAS/LULC/CERRADO_DEV/COL_11/LANDSAT/C11-POST-CLASSIFICATION/';
var out = 'projects/ee-ipam/assets/MAPBIOMAS/LULC/CERRADO_DEV/COL_11/LANDSAT/C11-POST-CLASSIFICATION/';

// Construct the base name of the input file
var inputFile = 'CERRADO_C11_gapfill_v' + inputVersion;

// Load the classification multi-band image
var inputClassification = ee.Image(root + inputFile);
print('Input classification', inputClassification);
Map.addLayer (inputClassification, vis, 'Input Classification');

// Spatial Filter Parameters
// Set the native processing scale in meters (Landsat spatial resolution)
var nativeScale = 30; 

// Set the minimum mapped unit in number of pixels (~1 hectare at 30m scale)
var minMappedPixels = 11;

// Define an array of classes protected from the spatial filter
// 3: Forest, 11: Wetland, 33: Water
var protectedClasses = [3, 11, 33]; 

// Set the starting and ending years 
var startYear = 1985;
var endYear = 2025;

// Define a function to generate a client-side array of sequential years
var makeYearList = function(startYear, endYear) {
  // Initialize an empty array to store the generated years
  var years = [];
  
  // Loop from the start year to the end year, appending each integer to the array
  for (var year = startYear; year <= endYear; year++) {years.push(year);}
  
  // Return the fully populated array of years
  return years;
};

// Execute the year list generation
var years = makeYearList(startYear, endYear);

// Define a helper function to create a boolean mask for a specific list of class values
var getClassMask = function(image, classList) {
  // Remap the target classes to 1, set all others to 0, and evaluate equality to 1
  return image.remap(classList, ee.List.repeat(1, classList.length), 0).eq(1);
};

// Define the core function to apply the focal mode spatial filter
var applySpatialFilter = function(image, kernelRadius) {
  // Extract the original band names from the input image to preserve them later
  var bandNames = image.bandNames();
  
  // Extract the original projection properties from the input image
  var projection = image.projection();

  // Reproject the image to explicitly force connected-pixel analysis at the native scale
  var imageAtNativeScale = image.reproject({
    crs: projection,
    scale: nativeScale
  });

  // Count connected pixels allowing diagonal connectivity (8-neighbor rule) up to a 50-pixel limit
  var connected8 = imageAtNativeScale.connectedPixelCount(50, true);

  // Count connected pixels strictly horizontally and vertically (4-neighbor rule) up to a 50-pixel limit
  var connected4 = imageAtNativeScale.connectedPixelCount(50, false);

  // Compute the focal mode (majority value) using a square kernel (radius 4 yields a 9x9 pixel window)
  var modeImage = image.focalMode(kernelRadius, 'square', 'pixels');

  // Generate a binary mask isolating the protected classes that must remain unfiltered
  var protectedMask = getClassMask(image, protectedClasses);

  // Generate a binary mask isolating Mosaic of Uses class (21)
  var class21Mask = image.eq(21);

  // Define the general filter mask targeting small patches of non-protected, non-class-21 pixels (8-neighbor)
  var generalMask = connected8
    .lte(minMappedPixels)
    .and(class21Mask.not())
    .and(protectedMask.not());

  // Define a stricter filter mask specifically for class 21 targeting patches evaluated via 4-neighbor connectivity
  var class21FilterMask = class21Mask
    .and(connected4.lte(minMappedPixels));

  // Apply the general spatial filter
  var modeGeneral = modeImage.updateMask(generalMask);

  // Apply the focal mode pixel replacement exclusively inside the class-21 target mask
  var modeClass21 = modeImage.updateMask(class21FilterMask);

  // Isolate and extract the exact original pixels belonging to the protected classes
  var protectedPixels = image
    .remap(protectedClasses, protectedClasses)
    .rename(bandNames);

  // Merge the filtered general patches, filtered class-21 patches, and protected pixels back over the original image
  var filtered = image
    .blend(modeGeneral)
    .blend(modeClass21)
    .blend(protectedPixels)
    .rename(bandNames)
    .byte();

  return filtered;
};

// Define a function to isolate and process a single annual classification band
var processYear = function(year) {
  // Cast the numeric year parameter to an Earth Engine Number object
  year = ee.Number(year);
  // Construct the expected band name string for the selected year
  var bandName = ee.String('classification_').cat(year.format('%d'));
  // Select the specific annual band from the overall input multi-band im
  var imageYear = inputClassification.select([bandName]);

  // Converting the original classes 15 (Pasture) and 18 (Agriculture) into 21 (Mosaic or Uses)
  var convertTo21Mask = getClassMask(imageYear, [15, 18]);
  
  // Temporarily merge classes 15 and 18 into class 21 to apply unified spatial filtering rules
  imageYear = imageYear
    .where(convertTo21Mask, 21)
    .rename(bandName)
    .byte();

  // Execute the focal mode spatial filter algorithm using a 4-pixel radius
  imageYear = applySpatialFilter(imageYear, 4);

  return imageYear;
};

// Iterate the processing function across all years to filter each band independently
var filteredYears = ee.List(years).map(processYear);

// Reconstruct the collection of single-band images back into a unified multi-band image
var finalImage = ee.ImageCollection
  .fromImages(filteredYears)
  .toBands();

// Dynamically generate the standardized list of target band names
var bandNames = ee.List(years).map(function(year) {
  return ee.String('classification_')
    .cat(ee.Number(year).format('%d'));
});

// Rename the final image bands and embed processing metadata attributes
finalImage = finalImage
  .rename(bandNames)
  .set({
    'filter': '07_spatial',
    'input_asset': inputFile,
    'input_version': inputVersion,
    'output_version': outputVersion,
  });

print('Output classification', finalImage);
Map.addLayer(finalImage, vis, 'Spatial filter applied');

// Export as GEE asset
Export.image.toAsset({
    'image': finalImage,
    'description': inputFile + '_spt_v' + outputVersion,
    'assetId': out +  inputFile + '_spt_v' + outputVersion,
    'pyramidingPolicy': {'.default': 'mode'},
    'region': finalImage.geometry(),
    'scale': 30,
    'maxPixels': 1e13
});
