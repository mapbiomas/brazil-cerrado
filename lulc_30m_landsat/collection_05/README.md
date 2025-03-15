<div>
    <img src='https://github.com/mapbiomas-brazil/cerrado/blob/mapbiomas60/2-general-map/www/ipam_logo.jpg?raw=true' height='auto' width='160' align='right'>
    <h1>Cerrado biome - Collection 5.0</h1>
</div>

Developed by [Instituto de Pesquisa Ambiental da Amazônia - IPAM](https://ipam.org.br/)<br>

## About
This folder contains the scripts to classify and filter the ***Cerrado*** Biome with Landsat images.

For detailed information about the classification and methodology, please read the Cerrado biome Appendix of the [Algorithm Theoretical Basis Document (ATBD).](https://brasil.mapbiomas.org/download-dos-atbds-com-metodo-detalhado/)

## How to use
1. Create an account in Google Earth Engine plataform.
2. Download or clone this repository to your local workspace.
   
## Pre-processing
✔ Step01: Build stable pixels from Collection 4.1 and save a new asset.

✔ Step02: Calculate area proportion for each class in each region to generate training samples.

✔ Step03: Export balanced training samples for each region.

✔ Step04: Export training samples for each year.

## Classification
✔ Step05: Export classification for each region.

## Post-processing
✔ Step06: Merge classification results and apply a Gap Fill filter.

✔ Step07a: Create an asset tracking changes in classification.

✔ Step07b: Apply incident filter.

✔ Step08: Apply temporal filter.

✔ Step09: Apply spatial filter.

✔ Step10: Apply frequency filter.

## Contact
For clarification or issue/bug report, please write to <felipe.lenti@ipam.org.br>
