## 01_trainingMask.js
Builds the training mask using stable pixels from the MapBiomas Collection 10.1 (1985 to 2024). The mask is refined using deforestation products (PRODES, MapBiomas Alert), FABDEM slope, regional reference maps, and GEDI-based vegetation height filtering. 
```javascript
// read training mask (Time Window: 2012 - 2024)
var trainingMask = ee.Image('projects/ee-ipam-cerrado/assets/Collection_11/masks/cerrado_trainingMask_2012_2024_v9');
var vis = {
    'min': 0,
    'max': 75,
    'palette': require('users/mapbiomas/modules:Palettes.js').get('brazil')
    };
    
// plot 
Map.addLayer(trainingMask, vis, 'trainingMask');
```
[Link to script](https://code.earthengine.google.com/067f475cfa2a1d2859b94665617c6b41)

## 02_computeProportion.js
Calculates the area of each land use and land cover class in each classification region. The main objective is to estimate the number of training samples required for each class, ensuring that the sample distribution adequately reflects the diversity of the regions.

## 03_samplePoints.js
Generates stratified spatial random points based on the stable pixels and computed area proportions (targeting 4,800 samples per region). This step also integrates manually collected complementary samples and removes specific misclassified points. 
```javascript
// read training samples (Time Window: 2012 - 2024)
var samplePoints = ee.FeatureCollection('projects/ee-ipam-cerrado/assets/Collection_11/sample/points/samplePoints_2012_2024_v14');

// plot
Map.addLayer(samplePoints, {}, 'samplePoints');
```
[Link to script](https://code.earthengine.google.com/c8e7caea1c203ea5bec71b0a0dab1ad8)

## 04_trainingSamples.py
Extracts spectral, fraction and geomorphometric signatures for the sample points across the Cerrado biome (1985–2025). This script utilizes annual Landsat mosaics, custom spectral indices, and Geomorpho90m topographic covariates to create the final training datasets.
```javascript
// inspect a sample of the training dataset 
var trainingPoints = ee.FeatureCollection('projects/mapbiomas-brazil/assets/LAND-COVER/COLLECTION-11/GENERAL/SAMPLES/CERRADO/v17/train_col11_reg10_1985_v17');

// plot
Map.addLayer(trainingPoints, {}, 'trainingSamples');
```
[Link to script](https://code.earthengine.google.com/21ea0d8261cecfc8fbaf6f5623972d84)

## 05_rfClassification.py
Performs annual LULC classification using a Random Forest model (`ee.Classifier.smileRandomForest()`) trained with the region-specific samples. The script classifies the multi-dimensional mosaics across all regions and exports both the discrete predicted classes and the continuous class-wise multiprobability bands.

## 06_gapFill.js
Fills temporal gaps (NoData) in the classified time series by replacing masked pixels with valid values from adjacent years. The filter searches forward in time (from `t0` to `tn`) and then backward (from `tn` to `t0`), ensuring continuity in areas affected by severe cloud or shadow contamination.

## 07_1stSpatial.js
Applies a spatial filter to remove small, isolated patches (Minimum Mappable Unit) and replaces them with the focal mode of a 9x9 pixel neighborhood (~1 ha). Specific native classes (Forest Formation (3), Wetland (11), and Water (33)) are protected from this filter to preserve fine ecological features.

## 08_topographic.js
Corrects topographically inconsistent LULC classes using the MERIT Digital Elevation Model (DEM). It converts anomalous Wetlands (11) and Water (33) occurrences on steep slopes into Forest (3), and replaces Mosaic of Uses (21) pixels on extremely steep slopes with the local focal mode.

## 09_transitions.js
Applies a combined temporal (3-year window) and spatial filter to remove small, spurious A-B-A class transitions. It groups LULC classes into broad thematic categories (Native, Anthropic, Other). If a pixel toggles classes back and forth within 3 years and forms a small spatial patch (≤6 pixels, 0.5 ha), it is reverted to its previous stable state.

## 10_sandbankVegetation.js
Identifies and maps herbaceous sandbank vegetation (Restinga Herbácea, 50) in coastal areas. It integrates a CPRM/SGB (Brazilian Geological Service) coastal sandy deposits vector with the historical frequency of Grassland (12) derived from the GTB Landsat-based classification. Based on frequency thresholds, eligible unstable classes are corrected to stable Grassland or Sandbank.

## 11_trajectories.js
Stabilizes specific Land Use and Land Cover (LULC) trajectories in the time series. It primarily targets Grassland (12), which often appears as an unstable intermediate state during the transition between native vegetation and anthropic classes. It also maps and cleans up false Non-Vegetated (25) gaps occurring within stable native areas.

## 12_frequency.js
Applies a temporal frequency filter to stabilize native vegetation classes. If a pixel is highly stable as native vegetation overall (>95% of the time) but fluctuates between specific native sub-classes (e.g., Forest vs. Savanna) without persisting for at least three consecutive years, the script forces the pixel to its dominant stable native class based on predefined hierarchical frequency thresholds.

## 13_temporal.js
This filter applies a set of temporal consistency rules to correct short-term spurious transitions and ensure the stability of land use and land cover (LULC) classifications over time (1985–2025). It operates by comparing each pixel’s class over multi-year windows and applying logic to eliminate implausible transitions, enforce class persistence, and refine the first and last years of the time series. The filter follows these five main steps:

 * 1. 5-year and 4-year window filtering:* The filter evaluates all pixels in a 5-year and a 4-year moving window. The objective is to correct pixel values that present a specific class in the initial year, change for two or three consecutive years, and return to the initial class (e.g., correcting `C-X-X-X-C` or `C-X-X-C` patterns). The rule is applied sequentially based on a predefined priority hierarchy, where classes processed later overwrite previous ones in case of conflict. The order is: River, Lake and Ocean (33), Other Non-Vegetated Areas (25), Mosaic of Uses (21), Grassland Formation (12), Wetland (11), Sandbank Vegetation (50), Savanna Formation (4), and Forest Formation (3).
    
  * 2. 3-year window filtering:* Similar to the first step, this rule identifies and corrects brief one-year transitions surrounded by the same class before and after (a `C-X-C` pattern). It uses the same hierarchical class order. Additionally, a critical constraint is applied from 2023 onwards: native vegetation classes are explicitly prevented from overwriting recent, verified anthropic conversions (Mosaic of Uses - 21) to preserve genuine new deforestations.
*3. Correction of unstable tails (2024–2025):* The filter identifies unstable two-year classification drops at the very end of the series. If a pixel was consolidated (the same class in 2022 and 2023) but spuriously transitions to Grassland (12) or Other Non-Vegetated (25) in 2024 and 2025, the artifact is removed, and the stable class from 2023 is carried forward through 2025.
  
*4. Correction of the last year (2025):* Two specific edge-case rules are applied for the final year: 
    a) The filter corrects single-year anomalies (`A-A-X`) by forcing 2025 to match 2024. However, if the 2025 class is Mosaic of Uses (21), it is preserved, as it often indicates a genuine, brand-new conversion. 
    b) It anchors recent agricultural activity: if 2024 was classified as Mosaic of Uses (21) with historical support (2022 or 2023 was also 21), but 2025 failed to classify as such, the 2025 value is corrected to 21 to avoid mapping unconfirmed regeneration.
*5. Stabilization of the first year (1985):* To prevent false anthropic artifacts from dominating the start of the series, the filter identifies `X-A-A` patterns at the beginning (1985–1987). If 1986 and 1987 are continuously classified as a native vegetation class, the 1985 classification is corrected backward to match them. This is prioritized strictly for Grassland (12), Wetland (11), Sandbank Vegetation (50), Savanna (4), and Forest (3).

## 14_falseRegrowth.js
Enforces strict temporal continuity specifically adapted for the short Sentinel time series. It applies distinct rules to remove false native vegetation regrowth, stabilizes initial years, and removes spurious temporary states bridging native vegetation and consolidated deforestation.

## 15_silviculture.js
A post-processing filter designed to correct the spectral confusion between Forest Plantation (Silviculture) and native Forest Formation (Class 3). Because fast-growing canopies mimic native forest reflectance, this script leverages long-term land-use history to correctly identify and revert false forest pixels back to Mosaic of Uses (Class 21).

## 16_spatialShapeFilter.js
Applies an Object-Based Image Analysis (OBIA) filter to remove small (<3 ha) and irregularly shaped patches of the Mosaic of Uses (21). Patches that exhibit a low bounding-box fill ratio, or lack a solid 3x3 pixel core (thin/fragmented speckles), are replaced by the focal mode of surrounding valid classes.

## 17_2stSpatial.js
Applies a second spatial filter to remove small, isolated patches (Minimum Mappable Unit) and replaces them with the focal mode of a 9x9 pixel neighborhood (~1 ha). Specific native classes (Forest Formation (3), Wetland (11), and Water (33)) are protected from this filter to preserve fine ecological features.

## Classification and methodology
For detailed information about the classification and methodology, please read the Cerrado biome (MapBiomas Collection 11) Appendix of the [Algorithm Theoretical Basis Document (ATBD).](https://brasil.mapbiomas.org/en/atbd-entenda-cada-etapa/)


