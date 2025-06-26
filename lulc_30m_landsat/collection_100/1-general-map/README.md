## 01_trainingMask.js
Builds the training mask using stable pixels from MapBiomas Collection 9 (1985-2023), GEDI-derived canopy height information, and additional spatial references to define training areas.
```javascript
// read training mask
var trainingMask = ee.Image('projects/mapbiomas-workspace/COLECAO_DEV/COLECAO10_DEV/CERRADO/LANDSAT/masks/cerrado_trainingMask_1985_2023_v1');
var vis = {
    'min': 0,
    'max': 62,
    'palette': require('users/mapbiomas/modules:Palettes.js').get('classification8')
    };

// visualize 
Map.addLayer(trainingMask, vis, 'trainingMask'); 
```
[Link to script](https://code.earthengine.google.com/270e1fcd56183416bc386cf8971e5731)

## 02_computeProportion.js
Calculates the area of each land use and land cover class in each classification region. The main objective is to estimate the number of training samples required for each class, ensuring the sample distribution reflects the landscape variability.

## 03_samplePoints.js
Uses the stable pixels to sort 4,800 training samples per classification region (total of 38 regions).
```javascript
// read training samples
var samplePoints = ee.FeatureCollection('projects/mapbiomas-workspace/COLECAO_DEV/COLECAO10_DEV/CERRADO/LANDSAT/sample/points/samplePoints_v1');

// plot
Map.addLayer(samplePoints, {}, 'samplePoints');
```
[Link to script](https://code.earthengine.google.com/341c97bacf3123b33ca6d91d8a52bec8)

## 04_trainingSamples.py
Generate annual training samples using Landsat mosaics (1985–2024), spectral indices, SMA, fire history, and geomorphometry data for the land use land cover classification.
```javascript
// inspect a sample of the training dataset 
var trainingPoints = ee.FeatureCollection('projects/mapbiomas-workspace/COLECAO_DEV/COLECAO10_DEV/CERRADO/LANDSAT/trainings/v11/train_col10_reg10_1985_v11');

// plot
Map.addLayer(trainingPoints, {}, 'trainingSamples');
```
[Link to script](https://code.earthengine.google.com/8dd90ac47d9b1b3e562a0d29d2d0b02c)

## 05_rfClassification.py
Perform annual land use land cover classification using a Random Forest model (ee.Classifier.smileRandomForest()) trained with region-specific samples. The script classifies Landsat mosaics from 1985 to 2024 across all regions and exports both the predicted class and class-wise probabilities.

## 06_gapFill.js
Fills temporal gaps in the classified land cover time series (1985–2024) by replacing NoData pixels with valid values from the nearest years. The filter first searches forward in time (future years) and then backward (past years), ensuring continuity in areas where cloud or shadow contamination affected classification outputs. Therefore, gaps should only remain in the final classified map when a given pixel was consistently classified as no-data throughout the entire temporal series. 

## 07_incidence.js
Removes spurious land cover transitions using temporal and spatial consistency filters. The script identifies unstable pixels with frequent changes (≥14 transitions, 1/3 of temporal series) and low connectivity (≤7 neighbors), replacing them with the most frequent class (mode) across the time series. This correction ensures temporal coherence and reduces noise, particularly in patches of native vegetation. Note that this filter was not applied to the Other non Vegetated Areas (25) and Rocky Outcrop (29) classes.  

## 08_sandbankVegetation.js
Detects and maps Herbaceous Sandbank Vegetation (Restinga Herbácea – class 50) by integrating SAVI time series, HAND, and soil data (Quartzarenic Neosols/Entisols). Pixels originally classified as natural vegetation or antropogenic uses (e.g., savanna formation, grassland formation, wetland, and mosaic of uses) are reassigned to class 50 when spectral and environmental conditions are met: SAVI between 0.13–0.145, HAND ≤ 3.5 m, and presence of sandy soils. 

## 09_frequency.js
Applies a post-classification filter to stabilize native vegetation classes based on their temporal consistency. Pixels classified as native vegetation (Forest Formation, Savanna Formation, Grassland Formation, Wetland, Herbaceous Sandbank Vegetation) for at least 90% of the time series (1985–2024) are reassigned to the dominant class using specific thresholds: Forest (≥70%), Wetland (≥60%), Sandbank Vegetation (≥60%), Grassland (≥50%), and Savanna (>40%). This enhances the temporal stability of native classes and reduces classification noise.

## 10_temporal.js
This filter applies a set of temporal consistency rules to correct short-term spurious transitions and ensure the stability of land use and land cover (LULC) classifications over time (1985–2024). It operates by comparing each pixel’s class over multi-year windows and applying logic to eliminate implausible transitions, enforce class persistence, and refine the first and last years of the time series. The filter follows these five main steps:
1. 5-year and 4-year window filtering: The filter evaluates all the pixels in a 5-year moving window (from 1986 to 2021) and a 4-year moving window (from 1986 to 2022). The objective is to correct pixel values that present a specific class in the previous year (year -1), change in the current year and return to the initial class in the last year of the window (year +2 or year +3). It is applied to each land use and cover class in the following order: Savanna Formation (4), Wetland (11), Forest Formation (3), Grassland Formation (12), Sandbank Vegetation (50), Mosaic of Uses (21), Other Non-Vegetated Areas (25), and River, Lake and Ocean (33).
2. 3-year window filtering: Similar to the first step, this rule identifies and corrects brief one-year transitions surrounded by the same class before and after (1986-2023). It uses a smaller window to capture and rectify short-term inconsistencies that were not addressed by the 4- or 5-year rules. The correction is executed in the same order of classes as in the initial step, ensuring temporal consistency over time.
3. Correction of the last year (2024): Two specific rules are applied: a) The filter searches for pixel values that were not classified as Mosaic of Uses (21) in 2024, but were classified as such in 2023 and 2022. The 2024 class is corrected to match the previous year, avoiding any regeneration that cannot be confirmed in the last year. b)If a pixel is suddenly classified as Other Non-Vegetated (25) in 2024, but not in 2022 and 2023, the 2024 value is corrected to retain the previous land use land cover class.
4. Stabilization of the first year (1985): If a pixel was classified as native vegetation (Forest, Savanna, Wetland, Grassland, or Sandbank) in both 1986 and 1987 but not in 1985, the classification is corrected to reflect native vegetation also in 1985. This ensures temporal consistency from the beginning of the series.
5. Removal of small patches of recent vegetation regrowth (2024): To avoid overestimating regeneration, only areas of native vegetation regrowth between 2023 and 2024 larger than 1 hectare (11 connected pixels) are retained. Smaller patches are assumed to be noise and are replaced by the 2023 class.

## 11_noFalseRegrowth.js
This script applies four post-classification rules to prevent false regrowth of native vegetation (Forest Formation and Wetlands), and to stabilize classes such as Non-Vegetated (25) and Sandbank Vegetation (50) over time in the Cerrado biome. It targets known issues of misclassification caused by spectral confusion or inconsistencies in classification models.
1. Prevent Forest Formation regrowth in stable silviculture areas: Pixels classified as Mosaic of Uses (class 21) for at least 7 consecutive years are not allowed to revert to Forest Formation (class 3).  If a forest class appears in these areas after this stable period, it is reverted back to 21. This prevents false reclassification of silviculture as native forest.
2. Correct false Wetland regeneration in early years (1985–1986): For Wetland (class 11), the classification in 1985 and 1986 is adjusted based on 1987. If 1985 or 1986 shows a transition that does not match the more stable 1987 classification, the earlier years are corrected. Additionally, from 1986 onwards, abrupt appearances of wetlands not supported by the previous year’s classification are corrected by reverting to the previous year’s class.
3. Stabilize Other non Vegetated Areas: If a pixel has been classified as Non-Vegetated (25) for at least 15 years and there is no occurrence of classes 12 (grassland) or 33 (water) in the entire time series, the pixel is considered stable. In these cases, the entire time series is reclassified as 25. This rule is restricted to a specific region in Gilbués, Piauí (PI), where this phenomenon is commonly observed.
4. Correct spurious appearance of Sandbank Vegetation: When class 50 appears in a given year but was not present in the previous year, the classification is assumed to be incorrect and is reverted to the previous year’s class. This rule helps to remove isolated or unstable occurrences of Herbaceous Sandbank Vegetation, ensuring temporal consistency.

## 12_geomorphometric.js
This filter removes pixels classified as Wetland (class 11) from areas with slopes greater than 9%, which are geomorphologically incompatible with wetland occurrence. The filter improves spatial consistency by eliminating false positives in undulating relief regions using a slope layer derived from the MERIT Digital Elevation Model (DEM).

## 13_spatial.js
The spatial filter avoids misclassifications at the edge of pixel groups and was built based on the "connectedPixelCount" function. Native to the GEE platform, this function locates connected components (neighbors) that share the same pixel value. Thus, only pixels that do not share connections to a predefined number of identical neighbors are considered isolated. At least six connected pixels are required to reach the minimum connection value. Consequently, the minimum mapping unit is directly affected by the spatial filter applied, and it was defined as eigth pixels (0.72 hectares).

## Classification and methodology
For detailed information about the classification and methodology, please read the Cerrado biome Appendix of the [Algorithm Theoretical Basis Document (ATBD).](https://mapbiomas.org/download-dos-atbds)


