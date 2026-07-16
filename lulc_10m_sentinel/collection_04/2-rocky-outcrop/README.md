## 00_aoiArea.js
Defines the Area of Interest (AOI) for mapping the rocky outcrop class. It calculates a 55 km spatial buffer around a set of collected samples to restrict the subsequent processing exclusively to relevant regions.

## 01_trainingMask.js
Builds the training mask based on highly stable pixels from the MapBiomas 10m Collection (2017 to 2024), aggregating detailed LULC into broad categories: Forest (1), Herbaceous and Shrubby Vegetation (2), Water and Wetland (3), Farming (4), and Non-Vegetated Area (5).
```javascript
// read training mask
var trainingMask = ee.Image('projects/ee-barbarasilvaipam/assets/collection-04_rocky-outcrop/masks/cerrado_rockyTrainingMask_2017_2024_v1');
var vis = { 
  min: 1, 
  max: 5, 
  palette: ["#1f8d49", "#d6bc74", "#2532e4", "#edde8e", "#d4271e"] };

// plot 
Map.addLayer(trainingMask, vis, 'trainingMask');
```
[Link to script](https://code.earthengine.google.com/953d647ec041e72869dd68dff38ee932)

## 02_computeProportion.js
Calculates the total area of Forest (1), Herbaceous and Shrubby Vegetation (2), Water and Wetland (3), Farming (4), and Non-Vegetated Area (5) within the AOI. The main objective is to estimate the proportional number of training samples required for each class, ensuring the distribution adequately reflects the region's landscape diversity.

## 03_samplePoints.js
Uses the stable pixels and computed proportions to generate 13,000 stratified random training samples. These automated samples are then merged with the curated samples collected manually by a specialist for the Rocky Outcrop class (29).
```javascript
// read training samples
var samplePoints = ee.FeatureCollection('projects/ee-barbarasilvaipam/assets/collection-04_rocky-outcrop/sample/points/samplePoints_v1');

// plot
Map.addLayer(samplePoints, {}, 'samplePoints');
```
[Link to script](https://code.earthengine.google.com/ee818ee2c6ddb07a64d9073f1b205d39)

## 04_trainingSamples.py
Extracts the temporal and geomorphometric signatures for the sample points generated in the previous step. It samples annual Google Satellite Embedding mosaics alongside Geomorpho90m topographic covariates to build the final training datasets.
```javascript
// inspect a sample of the training dataset 
var trainingPoints = ee.FeatureCollection('projects/ee-barbarasilvaipam/assets/collection-04_rocky-outcrop/trainings/v1/train_col04_rocky_2019_v1');

// plot
Map.addLayer(trainingPoints, {}, 'trainingSamples');
```
[Link to script](https://code.earthengine.google.com/804a053db9dc2a7f70a30772d0624c01)

## 05_rfClassification.py
Trains a Random Forest classifier (`ee.Classifier.smileRandomForest()`) using the extracted signatures and applies the model to the annual multi-dimensional mosaics. It exports both the discrete predicted class map and continuous multiprobability bands for further refinement.

## 06_gapFill.js
Fills temporal NoData gaps (caused by severe cloud or shadow contamination) by borrowing valid values from adjacent years. The filter searches forward in time (future years) and then backward (past years), ensuring continuity. Gaps only remain if a pixel was consistently masked throughout the entire temporal series.

## 07_frequency.js
Applies a strict geological stability filter exclusively to the Rocky Outcrop class. Because rocky outcrops are stable geological features, this filter requires a pixel to be classified as Rocky Outcrop for a minimum of 99% of the time series to be retained, resulting in a highly stable and reliable mapping of the class.

## 08_spatial.js
Applies a spatial filter to avoid misclassifications at the edge of pixel groups using the `connectedPixelCount` function. It enforces a Minimum Mappable Unit (MMU) of 20 connected pixels (~0.5 hectares). Isolated clusters that do not share at least 50 connections with the same class are eliminated and smoothed using the focal mode.

## 09_integration.js
Integrates the standalone Rocky Outcrop classification with the main MapBiomas Cerrado native/anthropic LULC map. Rocky Outcrop pixels overwrite any existing class *except* Forest Formation (Class 3). A final post-integration spatial filter is applied to remove tiny, spurious edge artifacts (≤ 6 pixels) caused by the overlap.

## Classification and methodology
For detailed information about the classification and methodology, please read the Cerrado biome (MapBiomas 10m Collection 3 BETA) Appendix of the [Algorithm Theoretical Basis Document (ATBD).](https://brasil.mapbiomas.org/en/atbd-entenda-cada-etapa/)

