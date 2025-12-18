## 01_trainingMask.js
Build the training mask based on stable pixels from MapBiomas Collection 10 (2016 to 2024), aggregating in classes: forest (1), herbaceous and shrubby vegetation (2), water and wetland (3), farming (4), non vegetated area (5) and rocky outcrop (29)
```javascript
// read training mask
var trainingMask = ee.Image('projects/ee-barbarasilvaipam/assets/collection-03_rocky-outcrop/masks/cerrado_rockyTrainingMask_2016_2024_v1');
var vis = {
    'min': 0,
    'max': 62,
    'palette': require('users/mapbiomas/modules:Palettes.js').get('classification8')
    };

// plot 
Map.addLayer(trainingMask, vis, 'trainingMask'); 
```
[Link to script](https://code.earthengine.google.com/83d20f92ca428697148c2d0342bfc838)

## 02_computeProportion.js
Calculates the area of forest (1), herbaceous and shrubby vegetation (2), water and wetland (3), farming (4), non vegetated area (5) and rocky outcrop (29). The main objective is to estimate the number of training samples required for each class, ensuring that the distribution of samples adequately reflects the diversity of the regions.

## 03_samplePoints.js
Uses the stable pixels to categorize 13,000 training samples. These are then combined with samples collected by a specialist for the rock outcrop class. 
```javascript
// read training samples
var samplePoints = ee.FeatureCollection('projects/ee-barbarasilvaipam/assets/collection-03_rocky-outcrop/sample/points/samplePoints_v1');

// plot
Map.addLayer(samplePoints, {}, 'samplePoints');
```
[Link to script](https://code.earthengine.google.com/ae908b9970a65ec0f05c0f6986033a7f)

## 04_trainingSamples.py
Use the sample points generated in the previous step to extract the spectral signatures from the Satellite Embedding mosaic for each year.
```javascript
// inspect a sample of the training dataset 
var trainingPoints = ee.FeatureCollection('projects/ee-barbarasilvaipam/assets/collection-03_rocky-outcrop/trainings/v1/train_col03_rocky_2019_v1');

// plot
Map.addLayer(trainingPoints, {}, 'trainingSamples');
```
[Link to script](https://code.earthengine.google.com/29eaaa32d6b38eea4bf693c645f2eb63)

## 05_rfClassification.py
Perfoms the model using the Random Forest classifier (ee.Classifier.smileRandomForest()) and subsequently classifies the annual Satellite Embedding mosaics

## 06_gapFill.js
No-data values (gaps) due to cloud and/or cloud shadow contaminated pixels in a given image were filled by the temporally nearest future valid classification. If no future valid classification was available, then the no-data value was replaced by its previous valid classification. Therefore, gaps should only remain in the final classified map when a given pixel was consistently classified as no-data throughout the entire temporal series. 

## 07_frequency.js
The frequency filter was applied exclusively to pixels classified as rocky outcrop for a minimum of 99% of the time series. This frequency filter resulted in a more stable classification of rocky outcrop class.

## 08_spatial.js
The spatial filter avoids misclassifications at the edge of pixel groups and was built based on the "connectedPixelCount" function. Native to the GEE platform, this function locates connected components (neighbors) that share the same pixel value. Thus, only pixels that do not share connections to a predefined number of identical neighbors are considered isolated. At least 100 connected pixels are required to reach the minimum connection value. Consequently, the minimum mapping unit is directly affected by the spatial filter applied, and it was defined as twenty pixels (0.2 hectares).

## Classification and methodology
For detailed information about the classification and methodology, please read the Cerrado biome (MapBiomas 10m Collection 3 BETA) Appendix of the [Algorithm Theoretical Basis Document (ATBD).](https://mapbiomas.org/download-dos-atbds)

