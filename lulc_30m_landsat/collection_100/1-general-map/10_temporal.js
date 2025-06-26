// --- --- --- 10_temporal
// Apply a temporal consistency filter to land use land cover classification maps,
// correcting short-term spurious transitions and stabilizing the first and last years 
// of the time series (1985–2024). This includes the removal of implausible class changes, 
// correction of isolated transitions, and exclusion of small patches of recent regrowth.

// Author: barbara.silva@ipam.org.br

// Import MapBiomas color palette
var vis = {
    min: 0,
    max: 62,
    palette:require('users/mapbiomas/modules:Palettes.js').get('classification8'),
    bands: 'classification_2024'
};

// Set root directory 
var root = 'projects/mapbiomas-workspace/COLECAO_DEV/COLECAO10_DEV/CERRADO/LANDSAT/C10-POST-CLASSIFICATION/';
var out = 'projects/mapbiomas-workspace/COLECAO_DEV/COLECAO10_DEV/CERRADO/LANDSAT/C10-POST-CLASSIFICATION/';

// Define input/output metadata
var inputVersion = '7';
var outputVersion = '16';

// Define input file
var inputFile = 'CERRADO_C10_gapfill_v11_incidence_v4_sandVeg_v3_freq_v'+inputVersion;

// Load classification image
var classificationInput = ee.Image(root + inputFile);
print('Input classification', classificationInput);
Map.addLayer(classificationInput, vis, 'Input classification');

// Remap agriculture and pasture (15, 18) to class 21 (mosaic of uses)
var classification = ee.Image([]);
ee.List.sequence({'start': 1985, 'end': 2024}).getInfo()
    .forEach(function(year_i) {
      
      // Get year [i]
      var classification_i = classificationInput.select(['classification_' + year_i])
        // Remap classes
        .remap([3, 4, 11, 12, 50, 15, 18, 25, 33],
               [3, 4, 11, 12, 50, 21, 21, 25, 33])
               .rename('classification_' + year_i);
               
               // Insert into aggregated classification
               classification = classification.addBands(classification_i);
    });


// -- -- -- --  Temporal filtering rules for 3, 4, and 5-year patterns
// -- Three years 
var rule_3yr = function(class_id, year, image) {
  var to_mask = image.select(['classification_' + String(year - 1)]).eq(class_id)    // previous
           .and(image.select(['classification_' + year]).neq(class_id))              // current
           .and(image.select(['classification_' + String(year + 1)]).eq(class_id));  // next

  return image.select(['classification_' + year])
              .where(to_mask.eq(1), class_id);
};

// -- Four years 
var rule_4yr = function(class_id, year, image) {
  var to_mask = image.select(['classification_' + String(year - 1)]).eq(class_id)      // previous
           .and(image.select(['classification_' + year]).neq(class_id))                // current
           .and(image.select(['classification_' + String(year + 1)]).neq(class_id))    // next
           .and(image.select(['classification_' + String(year + 2)]).eq(class_id));    // next two
  
  return image.select(['classification_' + year])
              .where(to_mask.eq(1), class_id);
};

// -- Five years
var rule_5yr = function(class_id, year, image) {
  var to_mask = image.select(['classification_' + String(year - 1)]).eq(class_id)      // previous
           .and(image.select(['classification_' + year]).neq(class_id))                // current
           .and(image.select(['classification_' + String(year + 1)]).neq(class_id))    // next
           .and(image.select(['classification_' + String(year + 2)]).neq(class_id))    // next two
           .and(image.select(['classification_' + String(year + 3)]).eq(class_id));    // next three
  
  return image.select(['classification_' + year])
              .where(to_mask.eq(1), class_id);
};


// -- -- -- -- Temporal filter runner functions
// -- Three years
var run_3yr = function(image, class_id) {
  var container = image.select(['classification_1985']);
  ee.List.sequence({'start': 1986, 'end': 2023}).getInfo()
      .forEach(function(year_i){
        container = container.addBands(rule_3yr(class_id, year_i, image));
      }
    );
  container = container.addBands(image.select(['classification_2024']));
  
  return container;
};

// -- Four years
var run_4yr = function(image, class_id) {
  var container = image.select(['classification_1985']);
  ee.List.sequence({'start': 1986, 'end': 2022}).getInfo()
      .forEach(function(year_i){
        container = container.addBands(rule_4yr(class_id, year_i, image));
      }
    );
  container = container.addBands(image.select(['classification_2023']))
                       .addBands(image.select(['classification_2024']));
  
  return container;
};

// -- Five years 
var run_5yr = function(image, class_id) {
  var container = image.select(['classification_1985']);
  ee.List.sequence({'start': 1986, 'end': 2021}).getInfo()
      .forEach(function(year_i){
        container = container.addBands(rule_5yr(class_id, year_i, image));
      }
    );
  container = container.addBands(image.select(['classification_2022']))
                       .addBands(image.select(['classification_2023']))
                       .addBands(image.select(['classification_2024']));
  
  return container;
};

// Fix first year [1985] if next two years are stable
var run_3yr_first = function(class_id, image) {
  var to_mask = image.select(['classification_1985']).neq(class_id)
           .and(image.select(['classification_1986']).eq(class_id))
           .and(image.select(['classification_1987']).eq(class_id));

  var first_yr = image.select(['classification_1985'])
                      .where(to_mask.eq(1), class_id);
  
  ee.List.sequence({'start': 1986, 'end': 2024}).getInfo()
      .forEach(function(year_i) {
        first_yr = first_yr.addBands(image.select(['classification_' + year_i]));
      });
  
  return first_yr;
};

// Fix last year [2024] if previous years (2022 and 2023) were stable in the target class
var run_3yr_last = function(class_id, image) {
  var to_mask = image.select(['classification_2024']).neq(class_id)
           .and(image.select(['classification_2023']).eq(class_id))
           .and(image.select(['classification_2022']).eq(class_id));
           
  var last_yr = image.select(['classification_2024'])
                      .where(to_mask.eq(1), class_id);
  
  var container = ee.Image([]);

  ee.List.sequence({'start': 1985, 'end': 2023}).getInfo()
      .forEach(function(year_i) {
        container = container.addBands(image.select(['classification_' + year_i]));
      });
  
  return container.addBands(last_yr);
  
};

// Fix last year [2024] if it shows false appearance of a class (both previous years are different)
var run_3yr_last_b = function(class_id, image) {
  var to_mask = image.select('classification_2024').eq(class_id)
    .and(image.select('classification_2023').neq(class_id))
    .and(image.select('classification_2022').neq(class_id));

  var last_yr = image.select('classification_2024')
    .where(to_mask, image.select('classification_2023'));

  var container = ee.Image([]);
  ee.List.sequence(1985, 2023).getInfo().forEach(function(year_i) {
    container = container.addBands(image.select('classification_' + year_i));
  });

  return container.addBands(last_yr.rename('classification_2024'));
};


// -- -- -- -- Start of conditionals 
// Create object to be filtered
var to_filter = classification; 

// -- -- -- -- Run time window general rules
// Apply filters to entire time series for each class
var class_ordering = [4, 11, 3, 12, 50, 21, 25, 33];

class_ordering.forEach(function(class_i) {
  
  // -- Five years
  to_filter = run_5yr(to_filter, class_i);
  
  // -- Four years
  to_filter = run_4yr(to_filter, class_i);
  
  // -- Three years
   to_filter = run_3yr(to_filter, class_i);
});

Map.addLayer(to_filter, vis, 'post: middle years filter');

// Apply last year corrections
to_filter = run_3yr_last (21, to_filter);
to_filter = run_3yr_last_b (25, to_filter);

Map.addLayer(to_filter, vis, 'post: last year filter');

// Apply first year corrections
to_filter = run_3yr_first(11, to_filter);
to_filter = run_3yr_first(4, to_filter);
to_filter = run_3yr_first(3, to_filter);
to_filter = run_3yr_first(12, to_filter);
to_filter = run_3yr_first(50, to_filter);

Map.addLayer(to_filter, vis, 'post: first year filter');

// Avoid that filter runs over small deforestation (remove small patches of vegetation regrowth in 2024)

// For each year
var remap_col = ee.Image([]);
ee.List.sequence({'start': 1985, 'end': 2024}).getInfo()
  .forEach(function(year_i) {
    // Get year [i] clasification
    var x = to_filter.select(['classification_' + year_i])
      // Perform remap
      .remap([3, 4, 11, 12, 50, 21],
             [3, 3,  3,  3, 50, 21])
             .rename('classification_' + year_i);
             
    // Put it on container data
    remap_col = remap_col.addBands(x);
  });

// Get regenrations from 2023 to 2024
var reg_last = remap_col.select(['classification_2024'])
                        .eq(3)
                        .and(remap_col.select(['classification_2023']).eq(21));

// Get regeneration sizes
var reg_size = reg_last.selfMask().connectedPixelCount(20, true).reproject('epsg:4326', null, 30);

// Get pixels with regenerations lower than 1 ha (900m² * 11 pixels) and retain 2023 class
var excludeReg = to_filter.select(['classification_2023'])
                    .updateMask(reg_size.lte(11).eq(1));

// Update 2023 year discarding only small regenerations
var x24 = to_filter.select(['classification_2024']).blend(excludeReg);

// Remove 2023 from time-series and add rectified data
to_filter = to_filter.slice(0, 39).addBands(x24.rename('classification_2024'));

Map.addLayer(to_filter, vis, 'post: small regeneration');
print ('Output classification', to_filter);

// Export as GEE asset
Export.image.toAsset({
    'image': to_filter,
    'description': inputFile + '_temp_v' + outputVersion,
    'assetId': out +  inputFile + '_temp_v' + outputVersion,
    'pyramidingPolicy': {
        '.default': 'mode'
    },
    'region': classification.geometry(),
    'scale': 30,
    'maxPixels': 1e13
});
