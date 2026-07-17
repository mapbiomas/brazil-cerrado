// --- --- --- 01) Training Mask by Period
// Generates robust training masks by overlapping temporal windows.
// It identifies stable pixels across MapBiomas Collections (8, 9, and 10),
// reclassifies them into target broad categories, and sequentially applies 
// a series of strict ancillary filters (deforestation, slope, regional reference 
// maps, and vegetation height). Finally, it enforces a Minimum Mappable Unit 
// (MMU) of ~1 hectare.

// Temporal Windows:
// 1985-1996 | 1994-2005 | 2003-2014 | 2012-2024


// Define the Cerrado extent for processing and export
var extent = ee.Geometry.Polygon(
  [[[-60.9355, -1.73410],
    [-60.9355, -25.1042],
    [-40.3691, -25.1042],
    [-40.3691, -1.73410]]],
  null, false
);

// Visualization parameters
var vis = {
    min: 0,
    max: 75,
    palette:require('users/mapbiomas/modules:Palettes.js').get('brazil')
};

// Set output directory and version string
var version_out = '9';
var dirout = 'projects/ee-ipam-cerrado/assets/Collection_11/masks/';

// Define overlapping temporal windows for sample extraction
var periods = [
  {name: '1985_1996', start: 1985, end: 1996},
  {name: '1994_2005', start: 1994, end: 2005},
  {name: '2003_2014', start: 2003, end: 2014},
  {name: '2012_2024', start: 2012, end: 2024}
];

// MapBiomas general collections
var col_10 = ee.Image('projects/mapbiomas-public/assets/brazil/lulc/collection10/mapbiomas_brazil_collection10_integration_v2');
var col_9  = ee.Image('projects/mapbiomas-public/assets/brazil/lulc/collection9/mapbiomas_collection90_integration_v1');
var col_8  = ee.Image('projects/mapbiomas-public/assets/brazil/lulc/collection8/mapbiomas_collection80_integration_v1');

// Available years in each collection
var years10_all = ee.List.sequence(1985, 2024).getInfo();
var years9_all  = ee.List.sequence(1985, 2023).getInfo();
var years8_all  = ee.List.sequence(1985, 2022).getInfo();


// DEFORESTATION MASKS
// ============================================================================

var prodes = ee.Image('projects/ee-ipam-cerrado/assets/ancillary/prodes-cerrado_2000-2025_v20260326_img');
var mb_alerta = ee.Image('projects/ee-ipam-cerrado/assets/ancillary/MBAlerta-cerrado_2019-2025_v20260105_img');


// SLOPE FILTER
// ============================================================================

var fabdemCol = ee.ImageCollection("projects/sat-io/open-datasets/FABDEM");
var proj = fabdemCol.first().projection();
var dem = fabdemCol.mosaic().setDefaultProjection(proj).clip(extent);
var slopePct = ee.Terrain.slope(dem).multiply(Math.PI / 180).tan().multiply(100).rename('slope_pct');


// REFERENCE MAP MASKS
// ============================================================================

// Read Brazilian states 
var assetStates = ee.Image('projects/mapbiomas-workspace/AUXILIAR/estados-2016-raster_old');

// Forest Inventory of the State of São Paulo (SEMA SP)
var sema_sp = ee.Image('projects/mapbiomas-workspace/MAPA_REFERENCIA/MATA_ATLANTICA/SP_IF_2020_2')
  .remap({
    'from': [3, 4, 5, 9, 11, 12, 13, 15, 18, 19, 20, 21, 22, 23, 24, 25, 26, 29, 30, 31, 32, 33],
    'to':   [3, 4, 3, 0, 11, 12, 12,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0]
  });

// CAR Thematic Mapping for the State of Tocantins
var sema_to = ee.Image('users/dh-conciani/basemaps/TO_Wetlands_CAR')
  .remap({'from': [11, 50, 128], 'to': [11, 11,   0]
  });

// Land use and land cover map of Distrito Federal (SEMA DF)
var sema_df = ee.Image('projects/barbaracosta-ipam/assets/base/DF_cobertura-do-solo_2019_img')
  .remap({'from': [3, 4, 11, 12], 'to': [3, 4, 11, 12], 'defaultValue': 0});

// Mapping 'Campos de Murundus' in the State of Goiás (SEMAD GO)
var semad_go = ee.Image(11).clip(ee.FeatureCollection('users/dh-conciani/basemaps/SEMA_GO_Murundus'));

// Wetlands of the southeastern region of the State of Tocantins 2018 (SEMARH TO)
var wetlands_TO = ee.Image('projects/ee-ipam-cerrado/assets/ancillary/TO_areas-umidas_2018_img');

// Land Use Land Cover of the southeastern region of the State of Tocantins 2018 (SEMA TO)
var lulc_TO = ee.Image("projects/ee-ipam-cerrado/assets/ancillary/TO_cobertura-uso_2018_img");

// Land Use Land Cover of Parque Nacional da Chapada das Mesas (Maranhão state)
var lulc_PNCM = ee.Image("projects/barbaracosta-ipam/assets/base/PNCM_mapa-vegetacao_image");

// Land Use and Land Cover of Fazenda Água Limpa (University of Brasília)
var lulc_FAL = ee.Image('projects/ee-ipam-cerrado/assets/ancillary/FAL-UNB_vegetacao_2019_img_v2');

// Wetlands of Mato Grosso 
var wetlands_MT = ee.Image('projects/ee-ipam-cerrado/assets/ancillary/MT_veredas_geoportal_img_v2');


// GEDI AND GPW BASED MASK  
// GEDI -- From Lang et al., 2022 (https://www.nature.com/articles/s41559-023-02206-6)
// ============================================================================
var canopy = ee.Image('users/nlang/ETH_GlobalCanopyHeight_2020_10m_v1');

var svh = ee.ImageCollection("projects/global-pasture-watch/assets/gsvh-30m/v1/short-veg-height_m")
  .filterDate('2024-01-01', '2025-01-01')
  .first().multiply(0.1).unmask(0);

// Classification Setup & Functions
var native_classes = [3, 4, 11, 12, 33];
var anthropic_classes = [15, 18, 25];
var valid_classes = [3, 4, 11, 12, 15, 18, 25, 33];

// Reclassify LULC MapBiomas classes to IPAM Cerrado target scheme
var reclassify = function(image) {
  return image.remap({
    from: [3, 4, 5, 6, 49, 11, 12, 32, 29, 50, 15, 19, 39, 20, 40, 62, 41, 36, 46, 47, 35, 48, 23, 24, 30, 33, 31],
    to:   [3, 4, 3, 3,  3, 11, 12, 12, 12, 12, 15, 18, 18, 18, 18, 18, 18, 18, 18, 18, 18, 18, 25, 25, 25, 33, 33]
  });
};

// Returns the number of distinct classes a pixel had over a time series
var numberOfClasses = function(image) {
  return image.reduce(ee.Reducer.countDistinctNonNull()).rename('number_of_classes');
};

// Filter years dynamically based on the temporal window
var getYearsInPeriod = function(start, end, availableYears) {
  var years = [];
  for (var y = start; y <= end; y++) {
    if (availableYears.indexOf(y) !== -1) years.push(y);
  }
  return years;
};

// Build a multiband image for a specific period
var buildRemappedCollection = function(collectionImage, years) {
  var out = ee.Image([]);
  years.forEach(function(year_i) {
    var band = reclassify(collectionImage.select('classification_' + year_i)).rename('classification_' + year_i);
    out = out.addBands(band);
  });
  return out;
};

// Minimum Mappable Unit (MMU) spatial filter function
var applyMMUByClass = function(image, classList, minPixels) {
  var out = ee.Image(0).updateMask(ee.Image(0));
  classList.forEach(function(classId) {
    var classMask = image.eq(classId).selfMask();
    var connected = classMask.connectedPixelCount(100, true);
    var filtered = image.updateMask(classMask).updateMask(connected.gte(minPixels));
    out = out.blend(filtered);
  });
  return out;
};

// Iterative Processing over Temporal Windows
periods.forEach(function(period) {
  print('Processing period:', period.name);

  var years10 = getYearsInPeriod(period.start, period.end, years10_all);
  var years9  = getYearsInPeriod(period.start, period.end, years9_all);
  var years8  = getYearsInPeriod(period.start, period.end, years8_all);

  var col_10_remap = buildRemappedCollection(col_10, years10);
  var col_9_remap  = buildRemappedCollection(col_9, years9);
  var col_8_remap  = buildRemappedCollection(col_8, years8);

  // Extract stable pixels from each collection
  var stable_10 = col_10_remap.select(0).updateMask(numberOfClasses(col_10_remap).eq(1));
  var stable_9  = col_9_remap.select(0).updateMask(numberOfClasses(col_9_remap).eq(1));
  var stable_8  = col_8_remap.select(0).updateMask(numberOfClasses(col_8_remap).eq(1));

  // Separate rules for native vs anthropic stability
  var is_native = stable_10.remap(native_classes, ee.List.repeat(1, native_classes.length), 0);
  var is_anthropic = stable_10.remap(anthropic_classes, ee.List.repeat(1, anthropic_classes.length), 0);

  var final_native = stable_10.updateMask(is_native.eq(1));
  var stable_in_all = ee.Image(1);
  if (years9.length > 0) stable_in_all = stable_in_all.and(stable_10.eq(stable_9));
  if (years8.length > 0) stable_in_all = stable_in_all.and(stable_10.eq(stable_8));
  var final_anthropic = stable_10.updateMask(is_anthropic.eq(1).and(stable_in_all));

  var stable = ee.ImageCollection([final_native, final_anthropic]).mosaic();
  Map.addLayer(stable, vis, '0. MB stable pixels ' + period.name, false);

  // --- Deforestation Mask
  stable = stable.where(prodes.eq(1).and(stable.eq(3).or(stable.eq(4)).or(stable.eq(11)).or(stable.eq(12))), 27);
  stable = stable.where(mb_alerta.eq(1).and(stable.eq(3).or(stable.eq(4)).or(stable.eq(11)).or(stable.eq(12))), 27);

  // --- Slope Filter
  stable = stable.where(stable.eq(11).and(slopePct.gte(9)), 3)
                 .where(stable.eq(15).and(slopePct.gte(20)), 27);

  // --- SEMA SP
  stable = stable.where(sema_sp.eq(0).and(stable.eq(3).or(stable.eq(4)).or(stable.eq(11)).or(stable.eq(12))), 27)
                 .where(stable.eq(12).and(assetStates.eq(35)), 27) // Remove grasslands from SP
                 .where(stable.eq(3).and(sema_sp.neq(3)), 27)
                 .where(stable.neq(3).and(sema_sp.eq(3)), 3)
                 .where(stable.eq(4).and(sema_sp.neq(4)), 27)
                 .where(stable.neq(4).and(sema_sp.eq(4)), 4)
                 .where(stable.gte(1).and(sema_sp.eq(12)), 12)
                 .where(stable.neq(11).and(sema_sp.eq(11)), 11);

  // --- SEMA TO
  stable = stable.where(sema_to.eq(11)
                  .and(stable.eq(4)
                  .or(stable.eq(12))
                  .or(stable.eq(27))), 11);
  // --- SEMA DF
  stable = stable.where(sema_df.eq(0)
                 .and(stable.eq(3)
                 .or(stable.eq(4))
                 .or(stable.eq(11))
                 .or(stable.eq(12))), 27);

  // --- SEMAD GO
  stable = stable.where(semad_go.eq(11)
                 .and(stable.eq(4)
                 .or(stable.eq(12))
                 .or(stable.eq(27))), 11);
                 
  // --- SEMARH TO               
  stable = stable.where(wetlands_TO.eq(1).and(stable.neq(11)), 11);
  
  // --- SEMA TO
  stable = stable.where(stable.neq(3).and(lulc_TO.eq(3)), 3)
                 .where(stable.neq(12).and(lulc_TO.eq(12)), 12)
                 .where(stable.neq(11).and(lulc_TO.eq(11)), 11);
                 
  // --- PNCM
  stable = stable.where(stable.neq(3).and(lulc_PNCM.eq(3)), 3)
                 .where(stable.neq(12).and(lulc_PNCM.eq(12)), 12)
                 .where(stable.neq(11).and(lulc_PNCM.eq(11)), 11)
                 .where(stable.neq(15).and(lulc_PNCM.eq(15)), 15);

  // --- FAL/UnB
  stable = stable.where(stable.neq(3).and(lulc_FAL.eq(3)), 3)
                 .where(stable.neq(4).and(lulc_FAL.eq(4)), 4)
                 .where(stable.neq(12).and(lulc_FAL.eq(12)), 12);

  // --- SEMA MT
  stable = stable.where(wetlands_MT.eq(11).and(stable.neq(11)), 11);

  // --- GEDI Canopy & GPW 
  stable = stable.where(stable.eq(3).and(canopy.lt(4)), 50)
                 .where(stable.eq(4).and(canopy.lte(2)), 50)
                 .where(stable.eq(4).and(canopy.gte(8)), 50)
                 .where(stable.eq(11).and(canopy.gte(15)), 50)
                 .where(stable.eq(12).and(svh.gte(3)), 50)
                 .where(stable.eq(15).and(svh.gte(4)), 50)
                 .where(stable.eq(18).and(svh.gte(3)), 50)
                 .where(stable.eq(25).and(canopy.gt(0)), 50)
                 .where(stable.eq(33).and(canopy.gt(0)), 50);

  // Minimum Mappable Unit (MMU)
  var validMask = stable.remap(valid_classes, ee.List.repeat(1, valid_classes.length), 0).eq(1);
  stable = stable.updateMask(validMask);
  
  // Apply MMU (~1 hectare / 11 Landsat pixels)
  var minPixels = 11;
  stable = applyMMUByClass(stable, valid_classes, minPixels);
  Map.addLayer(stable, vis, 'Final Stable Pixels ' + period.name, false);

  // Export as a GEE asset
  Export.image.toAsset({
    image: stable.toInt8(),
    description: 'cerrado_trainingMask_' + period.name + '_v' + version_out,
    assetId: dirout + 'cerrado_trainingMask_' + period.name + '_v' + version_out,
    scale: 30,
    pyramidingPolicy: {'.default': 'mode'},
    maxPixels: 1e13,
    region: extent
  });
});
