## 01_trainingMask.js
Build the training mask based on stable pixels from MapBiomas Collection 8 (1985 to 2022), aggregating in classes: native vegetation (1), non‑vegetation (2) and rocky outcrop (29)
```javascript
// read training mask
var trainingMask = ee.Image('projects/ee-barbarasilvaipam/assets/collection-10_rocky-outcrop/masks/cerrado_rockyTrainingMask_1985_2023_v4');
var vis = {
    'min': 0,
    'max': 62,
    'palette': require('users/mapbiomas/modules:Palettes.js').get('classification8')
    };

// visualize 
Map.addLayer(trainingMask, vis, 'trainingMask'); 
```
[Link to script](https://code.earthengine.google.com/da84ee76358a8786d00bc7b670ab6b35)

## 02_computeProportion.js
Calculates the area of forest vegetation (1), water (2), shrubby vegetation (3), anthropogenic (4), and rocky outcrop (29). The main objective is to estimate the number of training samples required for each class, ensuring that the distribution of samples adequately reflects the diversity of the regions.

## 03_samplePoints.js
Uses the stable pixels to categorize around 4,000 training samples. These are then combined with samples collected by a specialist for the rock outcrop class. 
```javascript
// read training samples
var samplePoints = ee.FeatureCollection('projects/ee-barbarasilvaipam/assets/collection-10_rocky-outcrop/sample/points/samplePoints_v4');

// visualize
Map.addLayer(samplePoints, {}, 'samplePoints');
```
[Link to script](https://code.earthengine.google.com/98c56a5bb6714d49cb8139696709487e)

## 04_trainingSamples.R
Use the sample points generated in the previous step to extract the spectral signatures from the Landsat Data Monthly image for each year.
```javascript
// inspect a sample of the training dataset 
var trainingPoints = ee.FeatureCollection('projects/ee-barbarasilvaipam/assets/collection-10_rocky-outcrop/trainings/v4/train_col10_rocky_1985_v4');

// visualize
Map.addLayer(trainingPoints, {}, 'trainingSamples (1985)');
```
[Link to script](https://code.earthengine.google.com/2214ceff3eb0d56268cd0aff7c566ead)

## 05_rfClassification.py
Perform the model using the Random Forest classifier (ee.Classifier.smileRandomForest()), which uses a multiprobability approach, to subsequently classify the monthly Landsat mosaics.

## 06_gapFill.js
Gaps due to cloud and/or cloud shadow contamination of pixels in a given image were filled by the temporally nearest future valid classification. If no such classification was available, the no-data value was replaced by the previous valid classification. Therefore, gaps in the final classified map should only remain when a pixel was consistently classified as "no data" throughout the entire temporal series.

## 07_frequency.js
The frequency filter was applied only to pixels classified as a rocky outcrop at least 90% of the time series. This filter produced a more stable classification of the rocky outcrop class.

## 08_spatial.js
The spatial filter, which was built based on the "connectedPixelCount" function, avoids misclassifications at the edge of pixel groups. This function, which is native to the GEE platform, locates connected components (neighbors) that share the same pixel value. Therefore, only pixels without connections to a predefined number of identical neighbors are considered isolated. At least six connected pixels are required to reach the minimum connection value. Consequently, the minimum mapping unit is directly affected by the applied spatial filter and is defined as 15 pixels (1.35 hectares).

## Classification and methodology
For detailed information about the classification and methodology, please read the Cerrado biome Appendix of the [Algorithm Theoretical Basis Document (ATBD).](https://mapbiomas.org/download-dos-atbds)

