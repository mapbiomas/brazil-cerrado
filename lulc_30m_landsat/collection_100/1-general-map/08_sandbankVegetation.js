// --- --- --- 08_sandbankVegetation

// Identify and classify Herbaceous Sandbank Vegetation (Restinga Herbácea) using SAVI, soil, and HAND data
// Combines SAVI thresholds, hydrological and soil masks, and reassigns class 50 for eligible native vegetation

// Author: barbara.silva@ipam.org.br

// Import MapBiomas color palette
var visParams = {
  min: 0,
  max: 62,
  palette: require('users/mapbiomas/modules:Palettes.js').get('classification8'),
  bands: 'classification_1985'
};

// Input data configuration
var mosaicAsset = 'projects/nexgenmap/MapBiomas2/LANDSAT/BRAZIL/mosaics-2';
var targetBiomes = ['CERRADO'];
var satellites = ['l5', 'l7', 'l8'];
var years = ee.List.sequence(1985, 2024);

// Soil mask for Quartzarenic Neosols (Entisols, Source: IBGE: Brazilian Institute of Geography and Statistics)
var soilMask = ee.Image(1).clip(
  ee.FeatureCollection('projects/barbaracosta-ipam/assets/base/IBGE_neossolo_quartzarenico_v3'));

Map.addLayer(soilMask, {}, 'Quartzarenic Neosols');

// HAND (Height Above Nearest Drainage)
var hand = ee.Image('MERIT/Hydro/v1_0_1').select('hnd');

// Classification input/output settings
var rootPath = 'projects/mapbiomas-workspace/COLECAO_DEV/COLECAO10_DEV/CERRADO/LANDSAT/C10-POST-CLASSIFICATION/';

var inputVersion = '4';
var outputVersion = '3';
var inputFileName = 'CERRADO_C10_gapfill_v11_incidence_v' + inputVersion;

var classificationInput = ee.Image(rootPath + inputFileName);
Map.addLayer(classificationInput, visParams, 'Input classification');

// Build SAVI time-series stack
var saviBandNames = years.map(function (year) {
  return ee.String('savi_').cat(ee.Number(year).toInt().format());
});

var saviStackRaw = ee.ImageCollection(years.map(function (year) {
  var mosaic = ee.ImageCollection(mosaicAsset)
    .filter(ee.Filter.eq('year', year))
    .filter(ee.Filter.inList('biome', targetBiomes))
    .filter(ee.Filter.inList('satellite', satellites))
    .mosaic()
    .select('savi_median')
    .rename(ee.String('savi_').cat(ee.Number(year).toInt().format()));
    return mosaic;
})).toBands();

var saviStack = saviStackRaw.rename(saviBandNames);
var allSaviBands = saviStack.select(saviBandNames);

// Apply temporal gap fill to SAVI time series
var applyGapFill = function (image) {

  // Forward fill (t0 → tn)
  var forwardFilled = saviBandNames.slice(1).iterate(function (bandName, prevImage) {
    bandName = ee.String(bandName);
    var current = image.select(bandName);
    prevImage = ee.Image(prevImage);

    current = current.unmask(prevImage.select([0]));
    return current.addBands(prevImage);

  }, ee.Image(allSaviBands.select([saviBandNames.get(0)])));

  forwardFilled = ee.Image(forwardFilled);

  // Backward fill (tn → t0)
  var reversedNames = saviBandNames.reverse();
  var backwardFilled = reversedNames.slice(1).iterate(function (bandName, prevImage) {
    bandName = ee.String(bandName);
    var current = forwardFilled.select(bandName);
    prevImage = ee.Image(prevImage);

    current = current.unmask(
      prevImage.select(prevImage.bandNames().length().subtract(1))
    );
    return prevImage.addBands(current);

  }, ee.Image(forwardFilled.select([reversedNames.get(0)])));

  return ee.Image(backwardFilled).select(saviBandNames);
};

var filledSavi = applyGapFill(allSaviBands);

// Identify sandy vegetation and assign class 50
var updatedClassification = ee.Image([]);

years.getInfo().forEach(function (year) {
  var yearStr = String(year);
  var originalClass = classificationInput.select('classification_' + yearStr);
  var savi = filledSavi.select('savi_' + yearStr);

  // Define masks for sandy vegetation
  var saviMask = savi.gte(13000).and(savi.lte(14500)).and(soilMask.eq(1));
  var handMask = hand.lte(3.5).and(soilMask.eq(1));

  // Eligible original classes (e.g., grassland, shrubland, wetland)
  var eligibleClasses = originalClass.eq(4)
    .or(originalClass.eq(11))
    .or(originalClass.eq(12))
    .or(originalClass.eq(21));

  // Apply condition and assign class 50
  var restingaCondition = (saviMask.or(handMask)).and(eligibleClasses);
  var updated = originalClass.where(restingaCondition, 50);

  updatedClassification = updatedClassification.addBands(updated.rename('classification_' + yearStr));
});

Map.addLayer(updatedClassification, visParams, 'Output classification');

// Export as GEE asset
Export.image.toAsset({
  image: updatedClassification,
  description: inputFileName + '_sandVeg_v' + outputVersion,
  assetId: rootPath + inputFileName + '_sandVeg_v' + outputVersion,
  pyramidingPolicy: { '.default': 'mode' },
  region: updatedClassification.geometry(),
  scale: 30,
  maxPixels: 1e13
});
