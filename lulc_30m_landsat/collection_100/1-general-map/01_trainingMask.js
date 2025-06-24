// --- --- --- 01_trainingMask
/* 
Generate training mask based on stable pixels from MapBiomas Collection 9.0, reference maps, and GEDI data
This script generates a training mask for the Cerrado biome by selecting stable pixels from MapBiomas Collection 9.0 and 
refining them using deforestation alerts, reference maps, and canopy height data (GEDI). 
The output is a reliable base for training classification algorithms.
*/
// Author: barbara.silva@ipam.org.br

// Define the Cerrado extent for export
var extent = ee.Geometry.Polygon(
  [[[-60.9355, -1.7341],
    [-60.9355, -25.1042],
    [-40.3691, -25.1042],
    [-40.3691, -1.7341]]],
  null, false
);

// Load Brazilian states (used for regional filters)
var assetStates = ee.Image('projects/mapbiomas-workspace/AUXILIAR/estados-2016-raster');

// Define output path and version
var dirout = 'projects/mapbiomas-workspace/COLECAO_DEV/COLECAO10_DEV/CERRADO/LANDSAT/masks/';
var version_out = '1';

// Load MapBiomas Collection 9.0
var collection = ee.Image('projects/mapbiomas-public/assets/brazil/lulc/collection9/mapbiomas_collection90_integration_v1');

// Remap classes to IPAM workflow schema
var reclassify = function(image) {
  return image.remap({
    from: [3, 4, 5, 6, 49, 11, 12, 32, 29, 50, 15, 19, 39, 20, 40, 62, 41, 36, 46, 47, 35, 48, 23, 24, 30, 33, 31],
    to:   [3, 4, 3, 3,  3, 11, 12, 12, 12, 12, 15, 18, 18, 18, 18, 18, 18, 18, 18, 18, 18, 18, 25, 25, 25, 33, 33]
  });
};

// Count distinct classes over the time series
var numberOfClasses = function(image) {
  return image.reduce(ee.Reducer.countDistinctNonNull()).rename('number_of_classes');
};

// Define years to process
var years = ee.List.sequence(1985, 2023).getInfo();

// Create image stack with remapped bands
var container = ee.Image([]);
years.forEach(function(year) {
  var reclassified = reclassify(collection.select('classification_' + year))
                    .rename('classification_' + year);
  container = container.addBands(reclassified);
});

// Select only stable pixels (i.e., pixels with the same class across all years)
var nClass = numberOfClasses(container);
var stable = container.select(0).updateMask(nClass.eq(1));

// MapBiomas color palette
var vis = {
  min: 0,
  max: 62,
  palette: require('users/mapbiomas/modules:Palettes.js').get('classification8')
};

Map.addLayer(stable, vis, '0. MB stable pixels', false);

// -----------------------------
//  DEFORESTATION FILTERS
// -----------------------------

// 1. PRODES (Cerrado deforestation)
var prodes = ee.Image('projects/ee-ipam-cerrado/assets/ancillary/prodes-cerrado_2000-2024_v20250225')
  .remap({from: ee.List.sequence(0, 24).add(100), to: ee.List.repeat(1, 25).add(0)});

stable = stable.where(
  prodes.eq(1).and(stable.eq(3).or(stable.eq(4)).or(stable.eq(11)).or(stable.eq(12))),
  27
);
Map.addLayer(stable, vis, '1. Filtered by PRODES', false);

// 2. MapBiomas Alert
var mb_alerta = ee.Image('projects/ee-ipam-cerrado/assets/ancillary/MBAlerta-cerrado_2019-2024_v20250225_img');

stable = stable.where(
  mb_alerta.eq(1).and(stable.eq(3).or(stable.eq(4)).or(stable.eq(11)).or(stable.eq(12))),
  27
);
Map.addLayer(stable, vis, '2. Filtered by MB Alert', false);

// -----------------------------
//  REFERENCE MAP FILTERS
// -----------------------------

// 3. São Paulo Forest Inventory
var sema_sp = ee.Image('projects/mapbiomas-workspace/MAPA_REFERENCIA/MATA_ATLANTICA/SP_IF_2020_2')
  .remap({
    from: [3, 4, 5, 9, 11, 12, 13, 15, 18, 19, 20, 21, 22, 23, 24, 25, 26, 29, 30, 31, 32, 33],
    to:   [3, 4, 3, 0, 11, 12, 12, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]
  });

// Apply forest inventory filters
stable = stable
  .where(sema_sp.eq(0).and(stable.eq(3).or(stable.eq(4)).or(stable.eq(11)).or(stable.eq(12))), 27)
  .where(stable.eq(12).and(assetStates.eq(35)), 27) // remove grasslands from São Paulo

  // Apply vegetation corrections
  .where(stable.eq(3).and(sema_sp.neq(3)), 27)
  .where(stable.neq(3).and(sema_sp.eq(3)), 3)
  .where(stable.eq(4).and(sema_sp.neq(4)), 27)
  .where(stable.neq(4).and(sema_sp.eq(4)), 4)
  .where(stable.gte(1).and(sema_sp.eq(12)), 12)
  .where(stable.neq(11).and(sema_sp.eq(11)), 11);

Map.addLayer(stable, vis, '3. Filtered by SEMA SP', false);

// 4. Tocantins (CAR thematic)
var sema_to = ee.Image('users/dh-conciani/basemaps/TO_Wetlands_CAR')
  .remap({from: [11, 50, 128], to: [11, 11, 0]});

stable = stable.where(
  sema_to.eq(11).and(stable.eq(4).or(stable.eq(12)).or(stable.eq(27))),
  11
);
Map.addLayer(stable, vis, '4. Filtered by SEMA TO', false);

// 5. Distrito Federal land cover
var sema_df = ee.Image('projects/barbaracosta-ipam/assets/base/DF_cobertura-do-solo_2019_img')
  .remap({from: [3, 4, 11, 12], to: [3, 4, 11, 12], defaultValue: 0});

stable = stable.where(
  sema_df.eq(0).and(stable.eq(3).or(stable.eq(4)).or(stable.eq(11)).or(stable.eq(12))),
  27
);
Map.addLayer(stable, vis, '5. Filtered by SEMA DF', false);

// 6. Murundus mapping - Goiás
var sema_go = ee.Image(11).clip(
  ee.FeatureCollection('users/dh-conciani/basemaps/SEMA_GO_Murundus')
);

stable = stable.where(
  sema_go.eq(11).and(stable.eq(4).or(stable.eq(12)).or(stable.eq(27))),
  11
);
Map.addLayer(stable, vis, '6. Filtered by SEMA GO', false);

// 7. Southeastern Tocantins Wetlands
var wetlands_TO = ee.Image('projects/ee-ipam-cerrado/assets/ancillary/TO_areas-umidas_2018_img');
stable = stable.where(wetlands_TO.eq(1).and(stable.neq(11)), 11);
Map.addLayer(stable, vis, '7. Filtered by Wetlands TO', false);

// 8. Tocantins LULC map
var lulc_TO = ee.Image('projects/ee-ipam-cerrado/assets/ancillary/TO_cobertura-uso_2018_img');

stable = stable
  .where(stable.neq(3).and(lulc_TO.eq(3)), 3)
  .where(stable.neq(12).and(lulc_TO.eq(12)), 12)
  .where(stable.neq(11).and(lulc_TO.eq(11)), 11);

Map.addLayer(stable, vis, '8. Filtered by LULC TO', false);

// -----------------------------
//  GEDI Canopy Height Filter
// -----------------------------
var canopy = ee.Image('users/nlang/ETH_GlobalCanopyHeight_2020_10m_v1');

stable = stable
  .where(stable.eq(3).and(canopy.lt(4)), 50)
  .where(stable.eq(4).and(canopy.lte(2)), 50)
  .where(stable.eq(4).and(canopy.gte(8)), 50)
  .where(stable.eq(11).and(canopy.gte(15)), 50)
  .where(stable.eq(12).and(canopy.gte(6)), 50)
  .where(stable.eq(15).and(canopy.gte(8)), 50)
  .where(stable.eq(18).and(canopy.gt(7)), 50)
  .where(stable.eq(25).and(canopy.gt(0)), 50)
  .where(stable.eq(33).and(canopy.gt(0)), 50);

Map.addLayer(stable, vis, '9. Filtered by GEDI', false);

//  Minimum Mappable Unit Filter
var minPixels = 11; // ~1 hectare
var connected = stable.connectedPixelCount(150, true).gte(minPixels);
stable = stable.updateMask(connected);

Map.addLayer(stable, vis, 'Stable pixels with min area (1 ha)');

//  Export as GEE Asset
Export.image.toAsset({
  image: stable.toInt8(),
  description: 'cerrado_trainingMask_1985_2023_v' + version_out,
  assetId: dirout + 'cerrado_trainingMask_1985_2023_v' + version_out,
  scale: 30,
  pyramidingPolicy: {'.default': 'mode'},
  maxPixels: 1e13,
  region: extent
});
