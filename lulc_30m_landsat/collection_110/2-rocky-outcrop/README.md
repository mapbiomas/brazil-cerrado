## 00_aoi.js
Defines the Area of Interest (AOI) for mapping the rocky outcrop class. It calculates a 55 km spatial buffer around a set of collected samples to restrict the subsequent processing exclusively to relevant regions.

## 01_trainingMask.js
Builds the training mask based on highly stable pixels from the MapBiomas Collection 10.1 (1985 to 2024), aggregating detailed LULC into broad categories: Forest (1), Herbaceous and Shrubby Vegetation (2), Farming (3), Non-vegetated (4), and Wetland and Water (5).
```javascript
// read training mask
var trainingMask = ee.Image('projects/ee-barbarasilvaipam/assets/collection-11_rocky-outcrop/masks/cerrado_rockyTrainingMask_1985_2024_v3');
var vis = {
  min: 1,
  max: 29,
  palette: [
    '#1f8d49','#d6bc74','#ffefc3','#d4271e','#2532e4','#000000',
    '#000000','#000000','#000000','#000000','#000000','#000000',
    '#000000','#000000','#000000','#000000','#000000','#000000',
    '#000000','#000000','#000000','#000000','#000000','#000000',
    '#000000','#000000','#000000','#000000','#000000','#ffaa5f'
  ],
};

// plot 
Map.addLayer(trainingMask, vis, 'trainingMask');
```
[Link to script](https://code.earthengine.google.com/54515cedeea79f1d84626187285e43c1)

## 02_computeProportion.js
Calculates the total area of Forest (1), Herbaceous and Shrubby Vegetation (2), Farming (3), Non-vegetated (4), and Wetland and Water (5) within the AOI. The main objective is to estimate the proportional number of training samples required for each class, ensuring the distribution adequately reflects the region's landscape diversity.

## 03_samplePoints.js
Uses the stable pixels and computed proportions to generate 4,800 stratified random training samples. These automated samples are then merged with the curated samples collected manually by a specialist for the Rocky Outcrop class (29).
```javascript
// read training samples
var samplePoints = ee.FeatureCollection('projects/ee-barbarasilvaipam/assets/collection-11_rocky-outcrop/sample/points/samplePoints_v3');

// plot
Map.addLayer(samplePoints, {}, 'samplePoints');
```
[Link to script](https://code.earthengine.google.com/734eb5999337b03443b697cbf88c7f4e)

## 04_trainingSamples.py
Extracts the spectral, fraction, and geomorphometric signatures for the sample points generated in the previous step. It samples annual Landsat mosaics alongside topographic covariates to build the final training datasets.
```javascript
// inspect a sample of the training dataset 
var trainingPoints = ee.FeatureCollection('projects/ee-ipam/assets/MAPBIOMAS/LULC/CERRADO_DEV/COL_11/LANDSAT/trainings_rocky/v3/train_col11_rocky_1985_v3');

// plot
Map.addLayer(trainingPoints, {}, 'trainingSamples');
```
[Link to script](https://code.earthengine.google.com/224db043fff24e3d0178874e5cc89b86)

## 05_rfClassification.py
Trains a Random Forest classifier (`ee.Classifier.smileRandomForest()`) using the extracted signatures and applies the model to the annual multi-dimensional mosaics. It exports both the discrete predicted class map and continuous multiprobability bands for further refinement.

## 06_gapFill.js
Fills temporal NoData gaps (caused by severe cloud or shadow contamination) by borrowing valid values from adjacent years. The filter searches forward in time (future years) and then backward (past years), ensuring continuity. Gaps only remain if a pixel was consistently masked throughout the entire temporal series.

## 07_frequency.js
Applies a strict geological stability filter exclusively to the Rocky Outcrop class. Because rocky outcrops are stable geological features, this filter requires a pixel to be classified as Rocky Outcrop for a minimum of 97% of the time series to be retained, resulting in a highly stable and reliable mapping of the class.

## 08_spatial.js
Applies a spatial filter to avoid misclassifications at the edge of pixel groups using the `connectedPixelCount` function. It enforces a Minimum Mappable Unit (MMU) of 11 connected pixels (~1 hectare). Isolated clusters that do not share at least 50 connections with the same class are eliminated and smoothed using the focal mode.

## 09_integration.js
Merges the Rocky Outcrop classification with the main Cerrado Land Use and Land Cover (LULC) stack and establishes regional background rules for Water. Rocky Outcrop (29) systematically overwrites the underlying native vegetation and anthropic classification across the entire biome. Computes orthogonal (4-way) connected components to identify and eliminate spurious micro-patches ($\le 6$ pixels) caused by map overlap, replacing them using a 2-pixel focal mode.

## Classification and methodology
For detailed information about the classification and methodology, please read the Cerrado biome (MapBiomas Collection 11) Appendix of the [Algorithm Theoretical Basis Document (ATBD).](https://brasil.mapbiomas.org/en/atbd-entenda-cada-etapa/)

