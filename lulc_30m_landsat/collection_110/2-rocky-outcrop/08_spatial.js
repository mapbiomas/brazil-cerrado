// -- -- -- -- 08) Spatial Filter
// This script applies a spatial filter to eliminate isolated or edge transition 
// pixels from the Rocky Outcrop classification. It enforces a Minimum Mappable 
// Unit (MMU) of 12 pixels (~1 hectare at 30m resolution). 
// Pixel clusters that do not share at least 20 connections (using 4-way 
// connectedness) with the same class are considered isolated noise and are 
// replaced by the focal mode of their surrounding 10-pixel neighborhood.


// Define visualization parameters
var vis = {
  min: 29, 
  max: 90, 
  palette: ['#ffaa5f','#e5e5e5'], 
  bands: 'classification_2020'
};

// Define the input version string matching the frequency filter output
var input_version = '4';

// Define the output version string for the spatial-filtered asset
var output_version = '8';

// Define the base directory path 
var root = 'projects/ee-ipam/assets/MAPBIOMAS/LULC/CERRADO_DEV/COL_11/LANDSAT/C11-ROCKY-POST-CLASSIFICATION/';
var dirout = 'projects/ee-ipam/assets/MAPBIOMAS/LULC/CERRADO_DEV/COL_11/LANDSAT/C11-ROCKY-POST-CLASSIFICATION/';

// Construct the base name of the input file
var inputFile = 'CERRADO_C11_rocky_gapfill_frequency_v' + input_version;

// Set the minimum number of connected pixels required (12 pixels = ~1 ha)
var filter_size = 12;

// Generate a sequential list of all years evaluated in the time series
var years = ee.List.sequence(1985, 2025).getInfo();

// Load the  multi-band classification image
var classification = ee.Image(root + inputFile);

// Print the loaded input classification metadata to the console for inspection
print("Input classification", classification);

// Add the original input classification layer to the map
Map.addLayer(classification, vis, 'Input classification', false);

// Initialize an empty Earth Engine image to accumulate the spatially filtered annual bands
var filtered = ee.Image([]);

// Iterate over each year in the defined time series
years.forEach(function(year_i) {
  
  // Select the specific annual band and unmask NoData pixels to 0 for spatial processing
  var currentBand = classification.select(['classification_' + year_i]).unmask(0);

  // Compute the focal mode (majority class) within a 10-pixel square radius
  var focal_mode = currentBand.focal_mode({'radius': 10, 'kernelType': 'square', 'units': 'pixels'});

  // Compute the number of contiguous connected pixels of the same class (using 4-way connections)
  var connections = currentBand.connectedPixelCount({'maxSize': 120, 'eightConnected': false});
  
  // Mask the focal mode image to retain only areas where the patch size is smaller than or equal to the filter threshold
  var to_mask = focal_mode.updateMask(connections.lte(filter_size));

  // Blend the original classification with the masked focal mode (replacing only the isolated small patches)
  // Reproject strictly to EPSG:4326 at 10m scale to force neighborhood computations at the native resolution
  var classification_i = currentBand.blend(to_mask).reproject('EPSG:4326', null, 30);

  // Remove the temporary 0 background mask and append the filtered band to the final multi-band stack
  filtered = filtered.addBands(classification_i.updateMask(classification_i.neq(0)));
});


// Render the final, spatially filtered classification map to the display
Map.addLayer(filtered, vis, 'Filtered Classification');

// Print the resulting final filtered image structure to the console
print('Output classification', filtered);

// Configure and execute the Earth Engine batch task to export the finalized image as an Asset
Export.image.toAsset({
  'image': filtered,
  'description': 'CERRADO_C11_rocky_gapfill_frequency_spatial_v' + output_version,
  'assetId': dirout + 'CERRADO_C11_rocky_gapfill_frequency_spatial_v' + output_version,
  'pyramidingPolicy': { '.default': 'mode' },
  'region': classification.geometry(),
  'scale': 30,
  'maxPixels': 1e13
});
