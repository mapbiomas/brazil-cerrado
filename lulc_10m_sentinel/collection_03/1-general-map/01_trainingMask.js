// -- -- -- -- 01_trainingMask
// generate training mask based on stable pixels from MapBiomas 10m collection 2.0 beta, reference maps, and GEDI data
// barbara.silva@ipam.org.br, dhemerson.costa@ipam.org.br and ana.souza@ipam.org.br

// Set Cerrado extent in which result will be exported 
var extent = ee.Geometry.Polygon(
  [[[-60.935545859442364, -1.734173093722467],
    [-60.935545859442364, -25.10422789569622],
    [-40.369139609442364, -25.10422789569622],
    [-40.369139609442364, -1.734173093722467]]], null, false);
  
// Read Brazilian states (to be used to filter reference maps)
var assetStates = ee.Image('projects/mapbiomas-workspace/AUXILIAR/estados-2016-raster');

// Set directory for the output file and version string
var dirout = 'projects/mapbiomas-workspace/COLECAO_DEV/COLECAO10_DEV/CERRADO/SENTINEL/masks/';
var version_out = '2';

// Read MapBiomas 10m LULC -- Collection 2.0
var collection = ee.Image('projects/mapbiomas-public/assets/brazil/lulc_10m/collection2/mapbiomas_10m_collection2_integration_v1');

// Function to reclassify the collection by IPAM workflow classes 
var reclassify = function(image) {
  return image.remap({
    'from': [3, 4, 5, 6, 49, 11, 12, 32, 29, 50, 15, 19, 9, 36, 23, 24, 30, 33, 31],
    'to':   [3, 4, 3, 3,  3, 11, 12, 12, 12, 12, 15, 18, 9, 18, 25, 25, 25, 33, 33]
  });
};

// Function to compute the number of classes over a given time series 
var numberOfClasses = function(image) {
    return image.reduce(ee.Reducer.countDistinctNonNull()).rename('number_of_classes');
};

// Set years to be processed 
var years = [2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023];

// Remap collection to ipam-workflow classes 
var container = ee.Image([]); // build an empty container

// Select classification for the year i and store in the container
years.forEach(function(i) {
  var yi = reclassify(collection.select('classification_' + i))
             .rename('classification_' + i);
  container = container.addBands(yi);
});

// Get the number of classes 
var nClass = numberOfClasses(container);

// Now, get only the stable pixels (nClass equals to one)
var stable = container.select(0).updateMask(nClass.eq(1));

// Import MapBiomas color schema 
var vis = {
    min: 0,
    max: 62,
    palette:require('users/mapbiomas/modules:Palettes.js').get('classification8')
};

// Plot stable pixels
Map.addLayer(stable, vis, '0. MB stable pixels', false);

// ============================================================================
//                          DEFORESTATION MASKS
// ============================================================================
// 1. PRODES (Cerrado deforestation)
var prodes = ee.Image('projects/ee-ipam-cerrado/assets/ancillary/prodes-cerrado_2000-2024_v20250225')
               .remap({from: ee.List.sequence(0, 24).add(100), to: ee.List.repeat(1, 25).add(0)});

stable = stable.where(
  prodes.eq(1).and(stable.eq(3).or(stable.eq(4)).or(stable.eq(11)).or(stable.eq(12))),
  27
);
Map.addLayer(stable, vis, '1. Filtered by PRODES', false);


// ============================================================================
//                           REFERENCE MAP MASKS
// ============================================================================

// 2 - Forest Inventory of the State of São Paulo (SEMA SP)
var sema_sp = ee.Image('projects/mapbiomas-workspace/MAPA_REFERENCIA/MATA_ATLANTICA/SP_IF_2020_2')
  .remap({
    'from': [3, 4, 5, 9, 11, 12, 13, 15, 18, 19, 20, 21, 22, 23, 24, 25, 26, 29, 30, 31, 32, 33],
    'to':   [3, 4, 3, 0, 11, 12, 12,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0]
  });

stable = stable.where(
  sema_sp.eq(0).and(stable.eq(3)
      .or(stable.eq(4))
      .or(stable.eq(11))
      .or(stable.eq(12))
  ), 27);

// Remove grasslands from São Paulo state
stable = stable.where(stable.eq(12).and(assetStates.eq(35)), 27);

// Apply rules for native vegetation
stable = stable
  // Forest Formation
  .where(stable.eq(3).and(sema_sp.neq(3)), 27)
  .where(stable.neq(3).and(sema_sp.eq(3)), 3)
  // Savanna Formation
  .where(stable.eq(4).and(sema_sp.neq(4)), 27)
  .where(stable.neq(4).and(sema_sp.eq(4)), 4)
  // Grassland
  .where(stable.gte(1).and(sema_sp.eq(12)), 12)
  // Wetland
  .where(stable.neq(11).and(sema_sp.eq(11)), 11);

Map.addLayer(stable, vis, '2. Filtered by SEMA SP', false);

// 3 - CAR Thematic Mapping for the State of Tocantins
var sema_to = ee.Image('users/dh-conciani/basemaps/TO_Wetlands_CAR')
  .remap({
    'from': [11, 50, 128],
    'to':   [11, 11,   0]
  });

stable = stable.where(
  sema_to.eq(11).and(stable.eq(4)
      .or(stable.eq(12))
      .or(stable.eq(27))
  ), 11);
  
Map.addLayer(stable, vis, '3. Filtered by SEMA TO', false);

// 4 - Land use and cover map of Distrito Federal (SEMA DF)
var sema_df = ee.Image('projects/barbaracosta-ipam/assets/base/DF_cobertura-do-solo_2019_img')
  .remap({
    'from': [3, 4, 11, 12],
    'to':   [3, 4, 11, 12],
    'defaultValue': 0
  });

stable = stable.where(
  sema_df.eq(0).and(stable.eq(3)
      .or(stable.eq(4))
      .or(stable.eq(11))
      .or(stable.eq(12))
  ), 27);
  
Map.addLayer(stable, vis, '4. Filtered by SEMA DF', false);

// 5 - Mapping 'Campos de Murundus' in the State of Goiás (SEMAD GO)
var sema_go = ee.Image(11).clip(
  ee.FeatureCollection('users/dh-conciani/basemaps/SEMA_GO_Murundus')
);

stable = stable.where(
  sema_go.eq(11).and( stable.eq(4)
      .or(stable.eq(12))
      .or(stable.eq(27))
  ), 11);
  
Map.addLayer(stable, vis, '5. Filtered by SEMA GO', false);

// 6 - Wetlands of the southeastern region of the State of Tocantins 2018 (SEMARH TO)
var wetlands_TO = ee.Image('projects/ee-ipam-cerrado/assets/ancillary/TO_areas-umidas_2018_img');

stable = stable.where(wetlands_TO.eq(1).and(stable.neq(11)), 11);
Map.addLayer(stable, vis, '6. Filtered by Wetlands TO', false);

// 7 - Land Use Land Cover of the southeastern region of the State of Tocantins 2018 (SEMA TO)
var lulc_SE_TO = ee.Image("projects/ee-ipam-cerrado/assets/ancillary/TO_cobertura-uso_2018_img");

stable = stable
  // Forest Formation
  .where(stable.neq(3).and(lulc_SE_TO.eq(3)), 3)
  // Grassland
  .where(stable.neq(12).and(lulc_SE_TO.eq(12)), 12)
  // Wetland
  .where(stable.neq(11).and(lulc_SE_TO.eq(11)), 11);
  
Map.addLayer(stable, vis, '7. Filtered by LULC SE TO', false);

// 8 - Land Use Land Cover of the State of Tocantins 2015 (SEMA TO)
var lulc_TO = ee.Image("projects/barbaracosta-ipam/assets/base/TO_cobertura-do-solo_2015_image");

stable = stable
  // Forest Formation
  .where((stable.eq(3)
    .or(stable.eq(11))
    .or(stable.eq(12))).and(lulc_TO.eq(3)), 3)

  // Grassland
  .where((stable.eq(3)
    .or(stable.eq(4))
    .or(stable.eq(11))
    .or(stable.eq(12))).and(lulc_TO.eq(12)), 12)
    
  // Wetland
  .where(stable.eq(4)
    .or(stable.eq(11))
    .or(stable.eq(12)).and(lulc_TO.eq(11)), 11)
    
  // Agriculture
  .where(stable.eq(3)
    .or(stable.eq(4))
    .or(stable.eq(11))
    .or(stable.eq(12))
    .and(lulc_TO.eq(18)), 18)
    
  // Water
  .where(stable.neq(33).and(lulc_SE_TO.eq(33)), 33);  

Map.addLayer(stable, vis, '8. Filtered by LULC TO', false);


// 9 - Land Use Land Cover of Parque Nacional da Chapada das Mesas (Maranhão state)
var lulc_PNCM = ee.Image("projects/barbaracosta-ipam/assets/base/PNCM_mapa-vegetacao_image");

stable = stable
  // Forest Formation
  .where(stable.neq(3).and(lulc_PNCM.eq(3)), 3)
  // Grassland
  .where(stable.neq(12).and(lulc_PNCM.eq(12)), 12)
  // Wetland
  .where(stable.neq(11).and(lulc_PNCM.eq(11)), 11)
  // Pature
  .where(stable.neq(15).and(lulc_PNCM.eq(15)), 15);
  
Map.addLayer(stable, vis, '9. Filtered by LULC PNCM', false);


// ============================================================================
//                          DEFORESTATION MASKS
// ============================================================================

// 10 - MapBiomas Alert (MB Alerta)
var mb_alerta = ee.Image('projects/ee-ipam-cerrado/assets/ancillary/MBAlerta-cerrado_2019-2024_v20250225_img');

stable = stable.where(
  mb_alerta.eq(1).and(stable.eq(3)
      .or(stable.eq(4))
      .or(stable.eq(11))
      .or(stable.eq(12))
  ), 27);
  
Map.addLayer(stable, vis, '10. Filtered by MB Alerta', false);;

// ============================================================================
//                          GEDI BASED MASK  
// From Lang et al., 2023 (https://www.nature.com/articles/s41559-023-02206-6)
// ============================================================================

// 11 - Canopy height (in meters)
var canopy_heigth = ee.Image('users/nlang/ETH_GlobalCanopyHeight_2020_10m_v1');

stable = stable
  .where(stable.eq(3).and(canopy_heigth.lt(4)), 50)
  .where(stable.eq(4).and(canopy_heigth.lte(2)), 50)
  .where(stable.eq(4).and(canopy_heigth.gte(8)), 50)
  .where(stable.eq(11).and(canopy_heigth.gte(15)), 50)
  .where(stable.eq(12).and(canopy_heigth.gte(6)), 50)
  .where(stable.eq(15).and(canopy_heigth.gte(8)), 50)
  .where(stable.eq(18).and(canopy_heigth.gt(7)), 50)
  .where(stable.eq(25).and(canopy_heigth.gt(0)), 50)
  .where(stable.eq(33).and(canopy_heigth.gt(0)), 50);

Map.addLayer(stable, vis, '11. Filtered by GEDI', false);
print ('Output image', stable);

//  Minimum Mappable Unit Filter
var minPixels = 11;  // ~0.1 hectare
var connected = stable.connectedPixelCount(150, true).gte(minPixels);
stable = stable.updateMask(connected);

Map.addLayer(stable, vis, '12. Stable pixels with min area (0.1 ha)');

// Export as GEE asset
Export.image.toAsset({
  image: stable.toInt8(),
  description: 'cerrado_trainingMask_2016_2023_v' + version_out,
  assetId: dirout + 'cerrado_trainingMask_2016_2023_v' + version_out,
  scale: 10,
  pyramidingPolicy: {'.default': 'mode'},
  maxPixels: 1e13,
  region: extent
}); 
