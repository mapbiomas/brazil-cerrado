// -- -- -- -- 03_samplePoints
// sort stratified spatialPoints by region using stable pixels
// barbara.silva@ipam.org.br

// Define metadata
var version = '1';

// Reference proportion
var file_in = ee.FeatureCollection('projects/ee-barbarasilvaipam/assets/collection-03_rocky-outcrop/sample/area/stable_v1');

// Read area of interest
var aoi_vec = ee.FeatureCollection('projects/ee-barbarasilvaipam/assets/collection-03_rocky-outcrop/masks/aoi_v1').geometry();
var aoi_img = ee.Image(1).clip(aoi_vec);
Map.addLayer(aoi_img, {palette:['red']}, 'Area of Interest');

// Define output
var output = 'projects/ee-barbarasilvaipam/assets/collection-03_rocky-outcrop/sample/points/';

// Define classes to generate samples
var classes = [1, 2, 3, 4, 5];

// Rocky outcrop samples
var rocky_samples = ee.FeatureCollection('projects/ee-barbarasilvaipam/assets/collection-03_rocky-outcrop/C03_rocky-outcrop-collected-v2')
        // Insert reference class [29] following the mapbiomas schema
        .map(function(feature) {
          return feature.set({'class': '29'}).select(['class']);
        });
        
// Define sample size
var sampleSize = 13000;    
var nSamplesMin = rocky_samples.size().round(); 

// Stable pixels from collection 10.0
var stablePixels = ee.Image('projects/ee-barbarasilvaipam/assets/collection-03_rocky-outcrop/masks/cerrado_rockyTrainingMask_2016_2024_v1')
                  .rename('class');
     
// Cerrado biome limit
var regionsCollection =  ee.FeatureCollection('projects/mapbiomas-workspace/AUXILIAR/biomas-2019')
                              .filterMetadata('Bioma', 'equals', 'Cerrado');

// Random color schema  
var vis = {
    'min': 1,
    'max': 29,
    'palette': ["32a65e","FFFFB2", "2532e4", "ffaa5f"]
};

Map.addLayer(stablePixels, vis, 'stable pixels');

// Read the area for each class (from the previous step)
var vegetation = ee.Number(file_in.first().get('1'));
var grassland = ee.Number(file_in.first().get('2'));
var water = ee.Number(file_in.first().get('3'));
var farming = ee.Number(file_in.first().get('4'));
var nonvegetated = ee.Number(file_in.first().get('5'));

// Compute the total area 
var total = vegetation
          .add(water)
          .add(grassland)
          .add(farming)
          .add(nonvegetated);

// Define the equation to compute the n of samples
var computeSize = function (number) {
  var minSamples = sampleSize * 0.02; // 2% do total
  return number.divide(total).multiply(sampleSize).round().int16().max(minSamples);
};

// Apply the equation to compute the number of samples
var n_vegetation = computeSize(ee.Number(vegetation));
var n_water = computeSize(ee.Number(water));
var n_grassland = computeSize(ee.Number(grassland));
var n_farming = computeSize(ee.Number(farming));
var n_nonvegetated = computeSize(ee.Number(nonvegetated));

// Generate the sample points
var training = stablePixels.stratifiedSample(
                              {'scale': 10,
                               'classBand': 'class', 
                               'numPoints': 0,
                               'region': aoi_img.geometry(),
                               'seed': 1,
                               'geometries': true,
                               'classValues': classes,
                               'classPoints': [n_vegetation, n_water, n_grassland, n_farming, n_nonvegetated]
                                }
                              );

// Merge with rocky samples
training = ee.FeatureCollection(training).merge(rocky_samples);

// Convert the 'class' column to integers
var trainingSamplesFixed = training.map(function(feature) {
  var classValue = ee.Number.parse(feature.get('class'));
  return feature.set('class', classValue);
});

// Plot points
Map.addLayer(trainingSamplesFixed, {}, 'samplePoints');

// Check if the conversion was done correctly
print("trainingSamplesFixed", trainingSamplesFixed.size());

// Print diagnosis for each class
print('vegetation', trainingSamplesFixed.filterMetadata('class', 'equals', 1).size());
print('grassland', trainingSamplesFixed.filterMetadata('class', 'equals', 2).size());
print('water', trainingSamplesFixed.filterMetadata('class', 'equals', 3).size());
print('farming', trainingSamplesFixed.filterMetadata('class', 'equals', 4).size());
print('nonvegetated', trainingSamplesFixed.filterMetadata('class', 'equals', 5).size());
print('rocky', trainingSamplesFixed.filterMetadata('class', 'equals', 29).size());

// Export as GEE asset
Export.table.toAsset({'collection': trainingSamplesFixed,
                      'description': 'samplePoints_v' + version,
                      'assetId':  output + 'samplePoints_v' + version
                      }
                    );
