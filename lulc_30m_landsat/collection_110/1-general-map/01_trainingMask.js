// -- -- -- -- 01) Stable Training Mask
// Creates a stable training mask for the Cerrado using MapBiomas 10 m Collection
// 3.0 and multiple ancillary datasets (reference maps, deforestation products,
// terrain information and vegetation structure).

// Set Cerrado extent for the final export
var extent = ee.Geometry.Polygon(
  [[[-60.935545859442364, -1.734173093722467],
    [-60.935545859442364, -25.10422789569622],
    [-40.369139609442364, -25.10422789569622],
    [-40.369139609442364, -1.734173093722467]]], null, false);

// Visualization parameters
var vis = {
    min: 0,
    max: 62,
    palette:require('users/mapbiomas/modules:Palettes.js').get('classification8')
};

// Set output directory and version string
var dirout = 'projects/ee-ipam-cerrado/assets/Collection_04/masks/';
var version_out = '1';

// Read MapBiomas 10m LULC (Collection 3.0)
var collection = ee.Image('projects/mapbiomas-public/assets/brazil/lulc_10m/collection3/mapbiomas_10m_collection3_integration_v1');

// Function to reclassify the collection into IPAM workflow classes
var reclassify = function(image) {
  return image.remap({
    'from': [3, 4, 5, 6, 49, 11, 12, 32, 29, 50, 15, 19, 36, 23, 24, 30, 33, 31],
    'to':   [3, 4, 3, 3,  3, 11, 12, 12, 12, 12, 15, 18, 18, 25, 25, 25, 33, 33]
  });
};

// Function to compute the number of unique classes over the time series
var numberOfClasses = function(image) {
    return image.reduce(ee.Reducer.countDistinctNonNull()).rename('number_of_classes');
};

// Define years to be processed and remap collection
var years = [2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024];

// Empty container for the time series
var container = ee.Image([]);

// Store reclassified images in the container
years.forEach(function(i) {
  var yi = reclassify(collection.select('classification_' + i)).rename('classification_' + i);
  container = container.addBands(yi);
});

// Extract stable pixels 
var nClass = numberOfClasses(container);

// Get the pixels where the number of classes across years equals one
var stable = container.select(0).updateMask(nClass.eq(1));

// Plot stable pixels
Map.addLayer(stable, vis, '0. MB stable pixels', false);


// DEFORESTATION MASKS
// ============================================================================

// 1. PRODES Cerrado
var prodes = ee.Image('projects/ee-ipam-cerrado/assets/ancillary/prodes-cerrado_2000-2025_v20260326_img');

// Apply rules for native vegetation
stable = stable.where(
  prodes.eq(1).and(stable.eq(3)
        .or(stable.eq(4))
        .or(stable.eq(11))
        .or(stable.eq(12))
        ), 27);

Map.addLayer(stable, vis, '1. Filtered by PRODES', false);

// 2. MapBiomas Alert
var mb_alerta = ee.Image('projects/ee-ipam-cerrado/assets/ancillary/MBAlerta_2019-2026_v20260515_img');

// Apply rules for native vegetation
stable = stable.where(
  mb_alerta.eq(1).and(stable.eq(3)
      .or(stable.eq(4))
      .or(stable.eq(11))
      .or(stable.eq(12))
      ), 27);
  
Map.addLayer(stable, vis, '2. Filtered by MB Alert', false);


// SLOPE FILTER
// ============================================================================

// 3. Slope filter 
var fabdemCol = ee.ImageCollection("projects/sat-io/open-datasets/FABDEM");
var proj = fabdemCol.first().projection();
var dem = fabdemCol.mosaic().setDefaultProjection(proj).clip(extent);

var slopeDeg = ee.Terrain.slope(dem);
var slopePct = slopeDeg.multiply(Math.PI / 180).tan().multiply(100).rename('slope_pct');

  stable = stable.where(stable.eq(11).and(slopePct.gte(9)), 3)
                 .where(stable.eq(15).and(slopePct.gte(20)), 27);
  
  Map.addLayer(stable, vis, '3. Filtered by Slope ', false);


// REFERENCE MAP MASKS
// ============================================================================

// Read Brazilian states 
var assetStates = ee.Image('projects/mapbiomas-workspace/AUXILIAR/estados-2016-raster_old');


// 4. Forest Inventory of the State of São Paulo (SEMA SP)
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
  .where(stable.eq(3).and(sema_sp.neq(3)), 27)
  .where(stable.neq(3).and(sema_sp.eq(3)), 3)
  .where(stable.eq(4).and(sema_sp.neq(4)), 27)
  .where(stable.neq(4).and(sema_sp.eq(4)), 4)
  .where(stable.gte(1).and(sema_sp.eq(12)), 12)
  .where(stable.neq(11).and(sema_sp.eq(11)), 11);

Map.addLayer(stable, vis, '4. Filtered by SEMA SP', false);


// 5. CAR Thematic Mapping for the State of Tocantins
var sema_to = ee.Image('users/dh-conciani/basemaps/TO_Wetlands_CAR')
  .remap({
    'from': [11, 50, 128],
    'to':   [11, 11,   0]
  });

// Apply rules for native vegetation
stable = stable.where(
  sema_to.eq(11).and(stable.eq(4)
      .or(stable.eq(12))
      .or(stable.eq(27))
      ), 11);
  
Map.addLayer(stable, vis, '5. Filtered by SEMA TO', false);


// 6. Land use and land cover map of Distrito Federal (SEMA DF)
var sema_df = ee.Image('projects/barbaracosta-ipam/assets/base/DF_cobertura-do-solo_2019_img')
  .remap({
    'from': [3, 4, 11, 12],
    'to':   [3, 4, 11, 12],
    'defaultValue': 0
  });

// Apply rules for native vegetation
stable = stable.where(
  sema_df.eq(0).and(stable.eq(3)
      .or(stable.eq(4))
      .or(stable.eq(11))
      .or(stable.eq(12))
      ), 27);
  
Map.addLayer(stable, vis, '6. Filtered by SEMA DF', false);


// 7. Mapping 'Campos de Murundus' in the State of Goiás (SEMAD GO)
var sema_go = ee.Image(11).clip(ee.FeatureCollection('users/dh-conciani/basemaps/SEMA_GO_Murundus'));

// Apply rules for native vegetation
stable = stable.where(
  sema_go.eq(11).and(stable.eq(4)
      .or(stable.eq(12))
      .or(stable.eq(27))
      ), 11);
  
Map.addLayer(stable, vis, '7. Filtered by SEMA GO', false);


// 8. Wetlands of the southeastern region of the State of Tocantins 2018 (SEMARH TO)
var wetlands_TO = ee.Image('projects/ee-ipam-cerrado/assets/ancillary/TO_areas-umidas_2018_img');

// Apply rules for native vegetation
stable = stable.where(
  wetlands_TO.eq(1)
  .and(stable.neq(11)
  ), 11);

Map.addLayer(stable, vis, '8. Filtered by Wetlands TO', false);


// 9. Land Use Land Cover of the southeastern region of the State of Tocantins 2018 (SEMA TO)
var lulc_SE_TO = ee.Image("projects/ee-ipam-cerrado/assets/ancillary/TO_cobertura-uso_2018_img");

// Apply rules for native vegetation
stable = stable
  .where(stable.neq(3).and(lulc_SE_TO.eq(3)), 3)
  .where(stable.neq(12).and(lulc_SE_TO.eq(12)), 12)
  .where(stable.neq(11).and(lulc_SE_TO.eq(11)), 11);
  
Map.addLayer(stable, vis, '9. Filtered by LULC SE TO', false);


// 10. Land Use Land Cover of the State of Tocantins 2015 (SEMA TO)
var lulc_TO = ee.Image("projects/barbaracosta-ipam/assets/base/TO_cobertura-do-solo_2015_image");

// Apply rules for native vegetation
stable = stable
  .where((stable.eq(3)
    .or(stable.eq(11))
    .or(stable.eq(12)))
    .and(lulc_TO.eq(3)), 3)

  .where((stable.eq(3)
    .or(stable.eq(4))
    .or(stable.eq(11))
    .or(stable.eq(12)))
    .and(lulc_TO.eq(12)), 12)
    
  .where(stable.eq(4)
    .or(stable.eq(11))
    .or(stable.eq(12))
    .and(lulc_TO.eq(11)), 11)
    
  .where(stable.eq(3)
    .or(stable.eq(4))
    .or(stable.eq(11))
    .or(stable.eq(12))
    .and(lulc_TO.eq(18)), 18)
    
  .where(stable.neq(33)
  .and(lulc_SE_TO.eq(33)), 33);  

Map.addLayer(stable, vis, '10. Filtered by LULC TO', false);


// 11. Land Use Land Cover of Parque Nacional da Chapada das Mesas (Maranhão state)
var lulc_PNCM = ee.Image("projects/barbaracosta-ipam/assets/base/PNCM_mapa-vegetacao_image");

// Apply rules for native vegetation
stable = stable
  .where(stable.neq(3).and(lulc_PNCM.eq(3)), 3)
  .where(stable.neq(12).and(lulc_PNCM.eq(12)), 12)
  .where(stable.neq(11).and(lulc_PNCM.eq(11)), 11)
  .where(stable.neq(15).and(lulc_PNCM.eq(15)), 15);
  
Map.addLayer(stable, vis, '11. Filtered by LULC PNCM', false);


// 12. Land Use and Land Cover of Fazenda Água Limpa (University of Brasília)
var lulc_FAL = ee.Image('projects/ee-ipam-cerrado/assets/ancillary/FAL-UNB_vegetacao_2019_img_v2');

// Apply rules for native vegetation
stable = stable
    .where(stable.neq(3).and(lulc_FAL.eq(3)), 3)
    .where(stable.neq(4).and(lulc_FAL.eq(4)), 4)
    .where(stable.neq(12).and(lulc_FAL.eq(12)), 12);

Map.addLayer(stable, vis, '12. Filtered by LULC FAL ', false);


// 13. Wetlands of Mato Grosso 
var wetlands_MT = ee.Image('projects/ee-ipam-cerrado/assets/ancillary/MT_veredas_geoportal_img_v2');

// Apply rules for native vegetation
stable = stable.where(
  wetlands_MT.eq(11)
  .and(stable.neq(11)), 11);
  
Map.addLayer(stable, vis, '13. Filtered by Wetlands MT ', false);


// GEDI AND GPW BASED MASK  
// GEDI -- From Lang et al., 2022 (https://www.nature.com/articles/s41559-023-02206-6)
// ============================================================================

// 14. Canopy height and short vegetation height (in meters)
var canopy = ee.Image('users/nlang/ETH_GlobalCanopyHeight_2020_10m_v1');

var svh = ee.ImageCollection("projects/global-pasture-watch/assets/gsvh-30m/v1/short-veg-height_m")
  .filterDate('2024-01-01', '2025-01-01')
  .first()
  .multiply(0.1)
  .unmask(0);

// Apply rules for native vegetation
 stable = stable
    .where(stable.eq(3).and(canopy.lt(4)), 50)
    .where(stable.eq(4).and(canopy.lte(2)), 50)
    .where(stable.eq(4).and(canopy.gte(8)), 50)
    .where(stable.eq(11).and(canopy.gte(15)), 50)
    .where(stable.eq(12).and(svh.gte(3)), 50)
    .where(stable.eq(15).and(svh.gte(4)), 50)
    .where(stable.eq(18).and(svh.gte(3)), 50)
    .where(stable.eq(25).and(canopy.gt(0)), 50)
    .where(stable.eq(33).and(canopy.gt(0)), 50);

Map.addLayer(stable, vis, '14. Filtered by Vegetation Height ', false);
  
print ('Output mask', stable);

// Minimum Mappable Unit (MMU) Filter
// Retains stable pixels with a minimum connected area (~0.25 hectare)
var minPixels = 25; 
var connected = stable.connectedPixelCount(50, true).gte(minPixels);
stable = stable.updateMask(connected);

Map.addLayer(stable, vis, '15. Stable pixels with min area (0.25 ha)');

// Export as GEE asset
Export.image.toAsset({
  image: stable.toInt8(),
  description: 'cerrado_trainingMask_2017_2025_v' + version_out,
  assetId: dirout + 'cerrado_trainingMask_2017_2025_v' + version_out,
  scale: 10,
  pyramidingPolicy: {'.default': 'mode'},
  maxPixels: 1e13,
  region: extent
}); 
