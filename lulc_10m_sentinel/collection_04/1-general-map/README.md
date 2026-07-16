## 01_trainingMask.js
Builds the training mask using stable pixels from the MapBiomas 10m Collection 3.0 (2017 to 2024). The mask is refined using deforestation products (PRODES, MapBiomas Alert), MERIT DEM slope, regional reference maps, and GEDI-based vegetation height filtering. 
```javascript
// read training mask
var trainingMask = ee.Image('projects/ee-ipam-cerrado/assets/Collection_04/masks/cerrado_trainingMask_2017_2025_v1');
var vis = {
    'min': 0,
    'max': 75,
    'palette': require('users/mapbiomas/modules:Palettes.js').get('brazil')
    };
    
// plot 
Map.addLayer(trainingMask, vis, 'trainingMask');
```
[Link to script](https://code.earthengine.google.com/d7ecdc5437f4360caded8bb4888ae591)

## 02_computeProportion.js
Calculates the area of each land use and land cover class in each classification region. The main objective is to estimate the number of training samples required for each class, ensuring that the sample distribution adequately reflects the diversity of the regions.

## 03_samplePoints.js
Generates stratified spatial random points based on the stable pixels and computed area proportions (targeting 4,800 samples per region). This step also integrates manually collected complementary samples and removes specific misclassified points. 
```javascript
// read training samples
var samplePoints = ee.FeatureCollection('projects/ee-ipam-cerrado/assets/Collection_04/sample/points/samplePoints_v4');

// plot
Map.addLayer(samplePoints, {}, 'samplePoints');
```
[Link to script](https://code.earthengine.google.com/dbafafd27b316624b01ad8c76164d015)

## 04_trainingSamples.py
Extracts spectral and geomorphometric signatures for the sample points across the Cerrado biome (2017–2025). This script utilizes annual Sentinel mosaics, Google Satellite Embeddings, custom spectral indices, and Geomorpho90m topographic covariates to create the final training datasets.
```javascript
// inspect a sample of the training dataset 
var trainingPoints = ee.FeatureCollection('projects/ee-ipam/assets/MAPBIOMAS/LULC/CERRADO_DEV/COL_11/SENTINEL/trainings/v4/train_col04_reg10_2017_v4');

// plot
Map.addLayer(trainingPoints, {}, 'trainingSamples');
```
[Link to script](https://code.earthengine.google.com/6ee83ed83ffed944c94f4cc91943ae04)

## 05_rfClassification.py
Performs annual LULC classification using a Random Forest model (`ee.Classifier.smileRandomForest()`) trained with the region-specific samples. The script classifies the multi-dimensional mosaics across all regions and exports both the discrete predicted classes and the continuous class-wise multiprobability bands.

## 06_gapFill.js
Fills temporal gaps (NoData) in the classified time series by replacing masked pixels with valid values from adjacent years. The filter searches forward in time (from `t0` to `tn`) and then backward (from `tn` to `t0`), ensuring continuity in areas affected by severe cloud or shadow contamination.

## 07_1stSpatial.js
Applies a spatial filter to remove small, isolated patches (Minimum Mappable Unit) and replaces them with the focal mode of a 9x9 pixel neighborhood (~0.5 ha). Specific native classes (Forest Formation (3), Wetland (11), and Water (33)) are protected from this filter to preserve fine ecological features.

## 08_topographic.js
Corrects topographically inconsistent LULC classes using the MERIT Digital Elevation Model (DEM). It converts anomalous Wetlands (11) and Water (33) occurrences on steep slopes into Forest (3), and replaces Mosaic of Uses (21) pixels on extremely steep slopes with the local focal mode.

## 09_transitions.js
Applies a combined temporal (3-year window) and spatial filter to remove small, spurious A-B-A class transitions. It groups LULC classes into broad thematic categories (Native, Anthropic, Other). If a pixel toggles classes back and forth within 3 years and forms a small spatial patch (≤25 pixels, 0.25 ha), it is reverted to its previous stable state.

## 10_sandbankVegetation.js
Identifies and maps herbaceous sandbank vegetation (Restinga Herbácea, 50) in coastal areas. It integrates a CPRM/SGB (Brazilian Geological Service) coastal sandy deposits vector with the historical frequency of Grassland (12) derived from the Landsat-based classification. Based on frequency thresholds, eligible unstable classes are corrected to stable Grassland or Sandbank.

## 11_trajectories.js
Applies rule-based temporal trajectory filters to stabilize specific transitions in the time series. It corrects spurious intermediate states (e.g., Grassland acting as a false bridge between Native Vegetation and Anthropic classes) and stabilizes erratic sequences, such as converting `4 → 12 → 21 → 4` into a stable `4 → 4 → 4 → 4` trajectory.

## 12_frequency.js
Stabilizes native vegetation classes based on their long-term temporal frequency over the entire period. If a pixel is highly stable as native vegetation overall (>95%) but fluctuates between specific native sub-classes (e.g., Forest vs. Savanna) without persisting for at least three consecutive years, it is forced to its dominant historical state based on predefined hierarchical thresholds.

## 13_temporal.js
*1. 3-year window filtering:* This rule identifies and corrects brief one-year transitions surrounded by the same class before and after (2018-2024). The objective is to correct pixel values that present a specific class in the previous year (year -1), change in the current year, and return to the initial class in the last year of the window (year +1).

*3. Correction of the last year (2025):* The filter searches for pixel values that were not classified as Mosaic of Uses (21) in 2025, but were classified as such in 2024 and 2023. The 2025 class is corrected to match the previous year, avoiding any regeneration that cannot be confirmed in the last year.

*4. Stabilization of the first year (2017):* If a pixel was classified as native vegetation (Forest, Savanna, Wetland, Grassland, or Sandbank) in both 2018 and 2019 but not in 2017, the classification is corrected to reflect native vegetation also in 2017. This ensures temporal consistency from the beginning of the series.

*5. Removal of small patches of recent vegetation regrowth (2025):* To avoid overestimating regeneration, only areas of native vegetation regrowth between 2024 and 2025 larger than 1 hectare are retained. Smaller patches are assumed to be noise and are replaced by the 2024 class.

## 14_falseRegrowth.js
Enforces strict temporal continuity specifically adapted for the short Sentinel time series. It applies 10 distinct rules to remove false native vegetation regrowth, stabilizes initial years, and removes spurious temporary states bridging native vegetation and consolidated deforestation.

## 15_spatialShapeFilter.js
Applies an Object-Based Image Analysis (OBIA) filter to remove small (<1 ha) and irregularly shaped patches of the Mosaic of Uses (21). Patches that exhibit a low bounding-box fill ratio, or lack a solid 3x3 pixel core (thin/fragmented speckles), are replaced by the focal mode of surrounding valid classes.

## 16_2stSpatial.js
Applies a second spatial filter to remove small, isolated patches (Minimum Mappable Unit) and replaces them with the focal mode of a 9x9 pixel neighborhood (~0.25 ha). Specific native classes (Forest Formation (3), Wetland (11), and Water (33)) are protected from this filter to preserve fine ecological features.

## Classification and methodology
For detailed information about the classification and methodology, please read the Cerrado biome (MapBiomas 10m Collection 3 BETA) Appendix of the [Algorithm Theoretical Basis Document (ATBD).](https://brasil.mapbiomas.org/en/atbd-entenda-cada-etapa/)


