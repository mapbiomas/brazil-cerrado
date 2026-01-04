## 01_stablePixels.js
Build the training mask based on stable pixels from MapBiomas Collection 10 (2016 to 2024), reference maps, and GEDI-based filtering 
```javascript
// read training mask
var trainingMask = ee.Image('projects/mapbiomas-workspace/COLECAO_DEV/COLECAO10_DEV/CERRADO/SENTINEL/masks/cerrado_trainingMask_2016_2023_v2');
var vis = {
    'min': 0,
    'max': 62,
    'palette': require('users/mapbiomas/modules:Palettes.js').get('classification8')
    };
// plot 
Map.addLayer(trainingMask, vis, 'trainingMask');
```
[Link to script](https://code.earthengine.google.com/6e950a0c1a03d7bbf91f66203fd530d9)

## 02_computeProportion.js
Calculates the area of each land use and land cover class in each classification region. The main objective is to estimate the number of training samples required for each class, ensuring that the distribution of samples adequately reflects the diversity of the regions.

## 03_samplePoints.js
Uses the stable pixels to sort 4,800 training samples for each classification region (38 regions). 
```javascript
// read training samples
var samplePoints = ee.FeatureCollection('projects/mapbiomas-workspace/COLECAO_DEV/COLECAO10_DEV/CERRADO/SENTINEL/sample/points/samplePoints_v3');

// plot
Map.addLayer(samplePoints, {}, 'samplePoints');
```
[Link to script](https://code.earthengine.google.com/943af496e0d468d4e54dea3114ba6c09)

## 04_trainingSamples.py
Generate annual training samples using Sentinel mosaics (2017–2024), Satellite Embedding (2017–2024), spectral indices, fire history, and geomorphometry data for the land use land cover classification.
```javascript
// inspect a sample of the training dataset 
var trainingPoints = ee.FeatureCollection('projects/mapbiomas-workspace/COLECAO_DEV/COLECAO10_DEV/CERRADO/SENTINEL/trainings/v9/train_col03_reg10_2019_v9');

// plot
Map.addLayer(trainingPoints, {}, 'trainingSamples');
```
[Link to script](https://code.earthengine.google.com/89c4ec3c792aa07c46daa4c010117a43)

## 05_rfClassification.py
Perform annual land use land cover classification using a Random Forest model (ee.Classifier.smileRandomForest()) trained with region-specific samples. The script classifies Sentinel mosaics from 2017 to 2024 across all regions and exports both the predicted class and class-wise probabilities.

## 06_gapFill.js
Fills temporal gaps in the classified land cover time series (2017–2024) by replacing NoData pixels with valid values from the nearest years. The filter first searches forward in time (future years) and then backward (past years), ensuring continuity in areas where cloud or shadow contamination affected classification outputs. Therefore, gaps should only remain in the final classified map when a given pixel was consistently classified as no-data throughout the entire temporal series.

## 07a_spectral-sandveg.js
Creates a balanced, multi-year samples dataset for the extraction of spectral signatures from Herbaceous Sandbank Vegetation (Restinga Herbácea) areas using manually collected polygons. Random points are generated within these polygons for each class to ensure reproducible and balanced sampling, and the points are labeled accordingly. The same spatial samples are then associated with annual reference images from 2017 to 2024.

## 07b_sandbankVegetation.js
This script identifies and maps Herbaceous Sandbank Vegetation (Restinga Herbácea) in the Cerrado using satellite embeddings combined with ecological and geological constraints. Manually curated sandbank vegetation samples and generic land-cover samples are filtered to coastal depositional environments and used to evaluate spectral separability across embedding bands, selecting the most discriminative feature via F-score analysis. An optimal classification threshold is defined using Youden’s J statistic, and a spectral mask is generated from the selected embedding band. This mask is further constrained by low HAND values (to represent wet or flood-prone environments) and coastal geological deposits. The resulting sandbank vegetation mask is then applied to annual land-cover maps (2017–2024)

## 08_frequency.js
The frequency filter was applied exclusively to pixels classified as native vegetation for a minimum of 90% of the time series. If a pixel was classified as Forest Formation for a period exceeding 70% of the time, that class was assigned to the pixel for the entirety of the period. The same rule was applied to Wetlands (95%), Savanna Formation (60%) and Grassland Formation (40%). This frequency filter resulted in a more stable classification of native vegetation classes. Another noteworthy outcome was the removal of noise in the ﬁrst and last years of classification, which the temporal filter may not have adequately assessed.

## 09_temporal.js
This filter applies a set of temporal consistency rules to correct short-term spurious transitions and ensure the stability of land use and land cover (LULC) classifications over time (2017–2024). It operates by comparing each pixel’s class over multi-year windows and applying logic to eliminate implausible transitions, enforce class persistence, and refine the first and last years of the time series. The filter follows these four main steps:

*1. 3-year window filtering:* This rule identifies and corrects brief one-year transitions surrounded by the same class before and after (2018-2023). The objective is to correct pixel values that present a specific class in the previous year (year -1), change in the current year, and return to the initial class in the last year of the window (year +1). It is applied to each land use and cover class in the following order: Savanna Formation (4), Grassland Formation (12), Forest Formation (3), Wetland (11), Herbaceous Sandbank Vegetation (50), Mosaic of Uses (21), River, Lake and Ocean (33), and Other Non-Vegetated Areas (25).

*3. Correction of the last year (2024):* The filter searches for pixel values that were not classified as Mosaic of Uses (21) in 2024, but were classified as such in 2023 and 2022. The 2024 class is corrected to match the previous year, avoiding any regeneration that cannot be confirmed in the last year.

*4. Stabilization of the first year (2017):* If a pixel was classified as native vegetation (Forest, Savanna, Wetland, Grassland, or Sandbank) in both 2018 and 2018 but not in 2017, the classification is corrected to reflect native vegetation also in 2017. This ensures temporal consistency from the beginning of the series.

*5. Removal of small patches of recent vegetation regrowth (2024):* To avoid overestimating regeneration, only areas of native vegetation regrowth between 2023 and 2024 larger than 1 hectare (11 connected pixels) are retained. Smaller patches are assumed to be noise and are replaced by the 2023 class.

## 10_noFalseRegrowth.js
This script applies a set of temporal post-classification rules to reduce false regrowth signals of native vegetation in annual land use and land cover maps. The approach is designed to correct abrupt or inconsistent class transitions that are unlikely from an ecological or land-use perspective.

*1. False Forest Formation Regrowth*  
This rule corrects spurious forest formation regeneration in silviculture areas by enforcing long-term persistence patterns at the beginning or end of the time series. Corrections are constrained using a stable reference classification to avoid introducing unrealistic transitions.

*2a. False Wetland Regeneration (Temporal Interruption)*  
This rule removes short-term wetland interruptions characterized by the pattern *wetland → mosaic → wetland (11 → 21 → 11)*, which are interpreted as classification artifacts rather than true land-cover change.

*2b. False Wetland Regeneration (Abrupt Appearance)*  
This rule prevents wetlands from appearing abruptly in a given year when they were not present in the previous year, enforcing temporal continuity in wetland dynamics.

*Rules 3 to 5 False Savanna, Grassland, and Herbaceous Sandbank Vegetation Regeneration (Abrupt Appearance)*
This rule ensures that these classes only appear when supported by temporal continuity, preventing isolated or spurious detections.

## 11_geomorphometric.js
This filter removes pixels classified as Wetland (11) or Water (33) from areas with slopes greater than 12% and 20%, respectively, which are geomorphologically incompatible with wetland and water occurrence. The filter improves spatial consistency by eliminating false positives in undulating relief regions using a slope layer derived from the MERIT Digital Elevation Model (DEM).

## 12_spatial.js
The spatial filter avoids misclassifications at the edge of pixel groups and was built based on the "connectedPixelCount" function. Native to the GEE platform, this function locates connected components (neighbors) that share the same pixel value. Thus, only pixels that do not share connections to a predefined number of identical neighbors are considered isolated. At least 100 connected pixels are required to reach the minimum connection value. Consequently, the minimum mapping unit is directly affected by the spatial filter applied, and it was defined as 60 pixels (0.60 hectares).

## Classification and methodology
For detailed information about the classification and methodology, please read the Cerrado biome (MapBiomas 10m Collection 3 BETA) Appendix of the [Algorithm Theoretical Basis Document (ATBD).](https://mapbiomas.org/download-dos-atbds)


