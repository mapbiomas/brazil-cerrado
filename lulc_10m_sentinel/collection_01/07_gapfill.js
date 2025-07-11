// Post-processing - Gapfill filling, uses raw classification as input
// For clarification write to <dhemerson.costa@ipam.org.br>

var geometry = 
    ee.Geometry.Polygon(
        [[[-54.92965566510598, -18.28361240107524],
          [-54.92965566510598, -22.687019005835637],
          [-50.59005605573098, -22.687019005835637],
          [-50.59005605573098, -18.28361240107524]]], null, false);

// define strings to be used as metadata
// input version
var dircol6 = 'users/dh-conciani/collection7/0_sentinel/c1-general';
var version = '2';    
var bioma = "CERRADO";

// queens case
var VeightConnected = true;

// define prefix for the output filename
var dirout = 'users/dh-conciani/collection7/0_sentinel/c1-general-post/';
var prefixo_out = 'CERRADO_sentinel_gapfill_v';
var version_out = '2';     

// dewfine year to plot a inspect
var ano = 2022;

////*************************************************************
// Do not Change from these lines
////*************************************************************

// import mapbiomas module
var palettes = require('users/mapbiomas/modules:Palettes.js');
var vis = {
    'min': 0,
    'max': 49,
    'palette': palettes.get('classification6')
};

// read raw classifiation 
var image = ee.ImageCollection(dircol6)
            .filterMetadata('version', 'equals', version)
            .filterMetadata('biome', 'equals', bioma)
            .min()

// filter image
image = image.mask(image.neq(0));
print(image);

// define years to be used in the filter
var years = [
    2016, 2017, 2018, 2019, 2020, 2021, 2022
    ];

/**
 * User defined functions
 */

var applyGapFill = function (image) {

    // apply the gap fill form t0 until tn
    var imageFilledt0tn = bandNames.slice(1)
        .iterate(
            function (bandName, previousImage) {

                var currentImage = image.select(ee.String(bandName));

                previousImage = ee.Image(previousImage);

                currentImage = currentImage.unmask(
                    previousImage.select([0]));

                return currentImage.addBands(previousImage);

            }, ee.Image(imageAllBands.select([bandNames.get(0)]))
        );

    imageFilledt0tn = ee.Image(imageFilledt0tn);

    // apply the gap fill form tn until t0
    var bandNamesReversed = bandNames.reverse();

    var imageFilledtnt0 = bandNamesReversed.slice(1)
        .iterate(
            function (bandName, previousImage) {

                var currentImage = imageFilledt0tn.select(ee.String(bandName));

                previousImage = ee.Image(previousImage);

                currentImage = currentImage.unmask(
                    previousImage.select(previousImage.bandNames().length().subtract(1)));

                return previousImage.addBands(currentImage);

            }, ee.Image(imageFilledt0tn.select([bandNamesReversed.get(0)]))
        );


    imageFilledtnt0 = ee.Image(imageFilledtnt0).select(bandNames);

    return imageFilledtnt0;
};

// get band names list 
var bandNames = ee.List(
    years.map(
        function (year) {
            return 'classification_' + String(year);
        }
    )
);

// generate a histogram dictionary of [bandNames, image.bandNames()]
var bandsOccurrence = ee.Dictionary(
    bandNames.cat(image.bandNames()).reduce(ee.Reducer.frequencyHistogram())
);

print(bandsOccurrence);

// insert a masked band 
var bandsDictionary = bandsOccurrence.map(
    function (key, value) {
        return ee.Image(
            ee.Algorithms.If(
                ee.Number(value).eq(2),
                image.select([key]).byte(),
                ee.Image().rename([key]).byte().updateMask(image.select(0))
            )
        );
    }
);

// convert dictionary to image
var imageAllBands = ee.Image(
    bandNames.iterate(
        function (band, image) {
            return ee.Image(image).addBands(bandsDictionary.get(ee.String(band)));
        },
        ee.Image().select()
    )
);

// generate image pixel years
var imagePixelYear = ee.Image.constant(years)
    .updateMask(imageAllBands)
    .rename(bandNames);

// apply the gap fill
var imageFilledtnt0 = applyGapFill(imageAllBands);
var imageFilledYear = applyGapFill(imagePixelYear);

print (image);
Map.addLayer(image.select('classification_'+ ano), vis, 'image',false);


Map.addLayer(imageFilledtnt0.select('classification_' + ano), vis, 'filtered');

// write metadata
imageFilledtnt0 = imageFilledtnt0.set('vesion', version_out);
print(imageFilledtnt0);

print(dirout+prefixo_out+version_out);

// export as GEE asset
Export.image.toAsset({
    'image': imageFilledtnt0,
    'description': prefixo_out+version_out,
    'assetId': dirout+prefixo_out+version_out,
    'pyramidingPolicy': {
        '.default': 'mode'
    },
    'region': geometry,
    'scale': 10,
    'maxPixels': 1e13
});
