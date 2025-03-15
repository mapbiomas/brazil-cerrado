## 01_stablePixels.js
Build the training mask based on stable pixels from MapBiomas Collection 9 (1985 to 2023), reference maps, and GEDI-based filtering 
```javascript
// read training mask
var trainingMask = ee.Image('projects/mapbiomas-workspace/COLECAO_DEV/COLECAO9_DEV/CERRADO/SENTINEL_DEV/masks/cerrado_trainingMask_1985_2023_v3');
var vis = {
    'min': 0,
    'max': 62,
    'palette': require('users/mapbiomas/modules:Palettes.js').get('classification8')
    };
// plot 
Map.addLayer(trainingMask, vis, 'trainingMask'); 
```
[Link to script](https://code.earthengine.google.com/6c4ee38af68d47233eee8d8d82324ad9)

## 02_computeProportion.js
Calculates the area of each land use and land cover class in each classification region. The main objective is to estimate the number of training samples required for each class, ensuring that the distribution of samples adequately reflects the diversity of the regions.

## 03_samplePoints.js
Uses the stable pixels to sort 7,000 training samples for each classification region (38 regions). 
```javascript
// read training samples
var samplePoints = ee.FeatureCollection('projects/mapbiomas-workspace/COLECAO_DEV/COLECAO9_DEV/CERRADO/SENTINEL_DEV/sample/points/samplePoints_v3');

// plot
Map.addLayer(samplePoints, {}, 'samplePoints');
```
[Link to script](https://code.earthengine.google.com/398c928b89613ab0536486c6f2f035bf)

## 04_getSignatures.R
Use the sample points generated in the previous step to extract the spectral signatures from the Sentinel image mosaic for each year (2016 to 2023).
```javascript
// inspect a sample of the training dataset 
var trainingPoints = ee.FeatureCollection('projects/mapbiomas-workspace/COLECAO_DEV/COLECAO9_DEV/CERRADO/SENTINEL_DEV/training/v5/train_col9_reg10_2016_v5');

// plot
Map.addLayer(trainingPoints, {}, 'trainingSamples');
```
[Link to script](https://code.earthengine.google.com/b18f2e7c6370f26357915c8743721c15)

## 06_rfClassification.R
Perfoms the model using the Random Forest classifier (ee.Classifier.smileRandomForest()) and subsequently classifies the annual Sentinel mosaics for each region of interest.

## 07_gapfill.js
No-data values (gaps) due to cloud and/or cloud shadow contaminated pixels in a given image were filled by the temporally nearest future valid classification. If no future valid classification was available, then the no-data value was replaced by its previous valid classification. Therefore, gaps should only remain in the final classified map when a given pixel was consistently classified as no-data throughout the entire temporal series. 

## 08_getSegments.js
Uses the SNIC (Simple Non-Iterative Clustering) algorithm to create segments from Sentinel annual mosaic images using SWIR1, NIR, and Red bands. It is a superpixel clustering based on neighboring pixels. The segmentation process combines spectral, spatial, textural, and contextual information to refine land use and land cover classification. 

## 09_segmentation.js
Applies the segments created in the previous step. Each segment was assigned the most common land cover class within it (mode filter) to align classification with segment boundaries, thereby reducing noise and improving overall classification consistency. 

## 10_frequency.js
The frequency filter was applied exclusively to pixels classified as native vegetation for a minimum of 85% of the time series. In the event that a pixel was classified as Forest Formation for a period exceeding 75% of the time, that class was assigned to the pixel for the entirety of the period. The same rule was applied to Wetlands (85%), Savanna Formation (40%) and Grassland Formation (50%). This frequency filter resulted in a more stable classification of native vegetation classes. Another noteworthy outcome was the removal of noise in the ﬁrst and last years of classification, which the temporal filter may not have adequately assessed.

## 11_temporal.js
This filter uses subsequent years to replace pixels that show invalid transitions in a given year, following the sequential steps detailed below:
1. The first step consists of a 3-year moving window from 2017 to 2022 (excluding first and last years) that corrects for all intermediate years, considering previous and subsequent years (-1 and +1 years). Each transition is evaluated according to an order of priority, being: Savanna Formation (4), Grassland Formation (12), Forest Formation (3), Wetland (11), Mosaic of Uses (21), Other Non-vegetated Areas (25) and River, Lake, and Ocean (33).
2. The second step involves checking the values of pixels that were not classified as Mosaic of Uses (21) in 2023 (last year) but were classified as such in 2022 and 2021. The value in 2023 is corrected to be consistent with previous years to avoid uncorrected regeneration in the recent year.
3. Finally, the filter verifies the regeneration of native vegetation (NV) in the last year. Pixels indicating regeneration between 2022 and 2023 are evaluated, and areas smaller than 1 ha are discarded to ensure classification consistency. 

## 12_noFalseRegrowth.js
This filter avoids the incorrect classification of native forest regeneration in forest plantation areas in recent years. Pixels that were initially classified as “Mosaic of Uses” (21) in 2016-2017 but were subsequently classified as Forest Formation in the following years were adjusted to retain the anthropogenic designation.

## 13_geomorphometric.js
The geomorphometric filter was applied only to the Wetland class (11) to mitigate erroneous classifications in areas characterized by unsuitable terrain conditions. This filter removed Wetland pixels located in regions with slopes exceeding 10 degrees. Pixels within these conditions were remapped to the most frequent neighboring land cover class, considering a kernel of 24 pixels.

## 14_spatial.js
The spatial filter avoids misclassifications at the edge of pixel groups and was built based on the "connectedPixelCount" function. Native to the GEE platform, this function locates connected components (neighbors) that share the same pixel value. Thus, only pixels that do not share connections to a predefined number of identical neighbors are considered isolated. At least six connected pixels are required to reach the minimum connection value. Consequently, the minimum mapping unit is directly affected by the spatial filter applied, and it was defined as six pixels (0.54 hectares).

## Classification and methodology
For detailed information about the classification and methodology, please read the Cerrado biome (MapBiomas 10m Collection 2 BETA) Appendix of the [Algorithm Theoretical Basis Document (ATBD).](https://mapbiomas.org/download-dos-atbds)


